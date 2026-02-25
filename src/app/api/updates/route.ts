import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";

// ─── Types ───

interface UpdateFile {
  filename: string;
  storedPath: string;
  type: string;
  size: number;
  extractedText: string | null;
}

interface CIBUpdate {
  id: string;
  topic: string;
  content: string;
  files: UpdateFile[];
  author: string;
  timestamp: string;
  extractedContent: string;
  superseded: boolean;
  supersededBy?: string;
}

// ─── Paths ───

const DATA_DIR = join(process.cwd(), "data");
const UPDATES_FILE = join(DATA_DIR, "updates.json");
const UPLOADS_DIR = join(process.cwd(), "data", "update-uploads");

// ─── Helpers ───

function loadUpdates(): CIBUpdate[] {
  try {
    if (existsSync(UPDATES_FILE)) {
      const raw = readFileSync(UPDATES_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    console.warn("[/api/updates] Could not read updates.json, starting fresh");
  }
  return [];
}

function saveUpdates(updates: CIBUpdate[]): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(UPDATES_FILE, JSON.stringify(updates, null, 2), "utf-8");
}

// ─── Text extraction ───

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
    const result = await parser.getText();
    await parser.destroy();
    return result.text.trim();
  } catch (err) {
    console.error("[/api/updates] PDF extraction failed:", err);
    return "";
  }
}

async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  } catch (err) {
    console.error("[/api/updates] DOCX extraction failed:", err);
    return "";
  }
}

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "pdf":
      return extractTextFromPDF(buffer);
    case "docx":
      return extractTextFromDOCX(buffer);
    case "txt":
    case "md":
      return buffer.toString("utf-8").trim();
    default:
      return "";
  }
}

// ─── POST handler — Create a new update ───

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const topic = formData.get("topic") as string;
    const content = formData.get("content") as string;
    const author = (formData.get("author") as string) || "Team Member";
    const files = formData.getAll("files") as File[];

    if (!topic || !topic.trim()) {
      return NextResponse.json(
        { error: "Topic is required" },
        { status: 400 }
      );
    }

    if ((!content || !content.trim()) && files.length === 0) {
      return NextResponse.json(
        { error: "Please provide text content or upload files" },
        { status: 400 }
      );
    }

    // Ensure uploads directory exists
    if (!existsSync(UPLOADS_DIR)) {
      await mkdir(UPLOADS_DIR, { recursive: true });
    }

    // Process files
    const processedFiles: UpdateFile[] = [];
    const extractedTexts: string[] = [];

    for (const file of files) {
      if (!file || file.size === 0) continue;

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Save file to disk
      const timestamp = Date.now();
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storedName = `${timestamp}-${sanitizedName}`;
      const storedPath = join(UPLOADS_DIR, storedName);
      await writeFile(storedPath, buffer);

      // Extract text from supported document types
      let extractedText: string | null = null;
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const isDocument = ["pdf", "docx", "txt", "md"].includes(ext);

      if (isDocument) {
        extractedText = await extractText(buffer, file.name);
        if (extractedText) {
          // Cap at 50k chars
          extractedText = extractedText.slice(0, 50000);
          extractedTexts.push(extractedText);
        }
      }

      processedFiles.push({
        filename: file.name,
        storedPath: storedName,
        type: file.type || ext,
        size: file.size,
        extractedText,
      });
    }

    // Create update object
    const updateId = `update_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newUpdate: CIBUpdate = {
      id: updateId,
      topic: topic.trim(),
      content: (content || "").trim(),
      files: processedFiles,
      author: author.trim(),
      timestamp: new Date().toISOString(),
      extractedContent: extractedTexts.join("\n\n"),
      superseded: false,
    };

    // Load existing updates and handle topic superseding
    const updates = loadUpdates();

    // Mark older updates with same topic as superseded
    const topicLower = newUpdate.topic.toLowerCase();
    for (const existing of updates) {
      if (
        !existing.superseded &&
        existing.topic.toLowerCase() === topicLower
      ) {
        existing.superseded = true;
        existing.supersededBy = updateId;
      }
    }

    updates.push(newUpdate);
    saveUpdates(updates);

    return NextResponse.json({
      success: true,
      update: {
        id: newUpdate.id,
        topic: newUpdate.topic,
        content: newUpdate.content,
        files: newUpdate.files.map((f) => ({
          filename: f.filename,
          type: f.type,
          size: f.size,
        })),
        author: newUpdate.author,
        timestamp: newUpdate.timestamp,
        superseded: false,
      },
      message: "Update saved successfully",
    });
  } catch (error) {
    console.error("[/api/updates] POST error:", error);
    return NextResponse.json(
      { error: "Failed to save update. Please try again." },
      { status: 500 }
    );
  }
}

// ─── GET handler — Retrieve all updates ───

export async function GET() {
  try {
    const updates = loadUpdates();

    // Sort by timestamp (newest first) and return without internal paths
    const sorted = updates
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .map((u) => ({
        id: u.id,
        topic: u.topic,
        content: u.content,
        files: u.files.map((f) => ({
          filename: f.filename,
          type: f.type,
          size: f.size,
        })),
        author: u.author,
        timestamp: u.timestamp,
        superseded: u.superseded,
        supersededBy: u.supersededBy,
      }));

    return NextResponse.json({ updates: sorted });
  } catch (error) {
    console.error("[/api/updates] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load updates" },
      { status: 500 }
    );
  }
}

// ─── DELETE handler — Delete a specific update ───

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Update ID is required" },
        { status: 400 }
      );
    }

    const updates = loadUpdates();
    const index = updates.findIndex((u) => u.id === id);

    if (index === -1) {
      return NextResponse.json(
        { error: "Update not found" },
        { status: 404 }
      );
    }

    updates.splice(index, 1);
    saveUpdates(updates);

    return NextResponse.json({ success: true, message: "Update deleted" });
  } catch (error) {
    console.error("[/api/updates] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete update" },
      { status: 500 }
    );
  }
}
