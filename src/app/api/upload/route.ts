import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const UPLOAD_DIR = join(process.cwd(), "uploads");
const DATA_DIR = join(process.cwd(), "data");
const CONTENT_FILE = join(DATA_DIR, "uploaded-content.json");
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];

interface UploadResponse {
  success: boolean;
  filename: string;
  message: string;
}

interface UploadedContent {
  filename: string;
  uploadedAt: string;
  content: string;
  charCount: number;
}

// ─── Text extraction by file type ───

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
  const result = await parser.getText();
  await parser.destroy();
  return result.text.trim();
}

async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function extractTextFromPlainText(buffer: Buffer): Promise<string> {
  return buffer.toString("utf-8").trim();
}

async function extractText(
  buffer: Buffer,
  extension: string
): Promise<string> {
  switch (extension) {
    case ".pdf":
      return extractTextFromPDF(buffer);
    case ".docx":
      return extractTextFromDOCX(buffer);
    case ".txt":
    case ".md":
      return extractTextFromPlainText(buffer);
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
}

// ─── Manage uploaded content store ───

function loadContentStore(): UploadedContent[] {
  try {
    if (existsSync(CONTENT_FILE)) {
      const raw = readFileSync(CONTENT_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    console.warn("Could not read uploaded-content.json, starting fresh");
  }
  return [];
}

function saveContentStore(contents: UploadedContent[]): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(CONTENT_FILE, JSON.stringify(contents, null, 2), "utf-8");
}

// ─── POST handler ───

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, filename: "", message: "No file was selected. Please choose a file and try again." },
        { status: 400 }
      );
    }

    // Validate file extension
    const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json<UploadResponse>(
        {
          success: false,
          filename: file.name,
          message: `"${ext}" files aren't supported yet. Please upload a PDF, DOCX, TXT, or MD file.`,
        },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_SIZE) {
      return NextResponse.json<UploadResponse>(
        {
          success: false,
          filename: file.name,
          message: `This file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). The maximum size is 10 MB.`,
        },
        { status: 400 }
      );
    }

    // Ensure upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    // Generate unique filename to prevent overwrites
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueName = `${timestamp}-${sanitizedName}`;
    const filePath = join(UPLOAD_DIR, uniqueName);

    // Read file bytes
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Write file to disk
    await writeFile(filePath, buffer);

    // ─── Extract text content ───
    let extractedText = "";
    try {
      extractedText = await extractText(buffer, ext);
    } catch (extractError) {
      console.error("Text extraction failed:", extractError);
      // File is saved but text extraction failed — still a partial success
      return NextResponse.json<UploadResponse>({
        success: true,
        filename: file.name,
        message: `${file.name} uploaded but text extraction failed. The file is saved for reference.`,
      });
    }

    // ─── Save extracted text to uploaded-content.json ───
    const contentStore = loadContentStore();

    const newEntry: UploadedContent = {
      filename: file.name,
      uploadedAt: new Date().toISOString(),
      content: extractedText.slice(0, 50000), // Cap at 50k chars to keep context manageable
      charCount: extractedText.length,
    };

    contentStore.push(newEntry);
    saveContentStore(contentStore);

    const charDisplay =
      extractedText.length > 1000
        ? `${(extractedText.length / 1000).toFixed(1)}k`
        : String(extractedText.length);

    return NextResponse.json<UploadResponse>({
      success: true,
      filename: file.name,
      message: `${file.name} uploaded and processed (${charDisplay} chars extracted)`,
    });
  } catch (error) {
    console.error("[/api/upload] Unhandled error:", error);
    return NextResponse.json<UploadResponse>(
      {
        success: false,
        filename: "",
        message: "Something went wrong while uploading. Please try again.",
      },
      { status: 500 }
    );
  }
}
