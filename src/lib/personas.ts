import {
  Code,
  LayoutDashboard,
  Briefcase,
  TrendingUp,
  Megaphone,
  Headphones,
  Heart,
  Wrench,
  Scale,
  Palette,
  type LucideIcon,
} from "lucide-react";

export interface Persona {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
}

export const personas: Persona[] = [
  {
    id: "developer",
    name: "Developer",
    icon: Code,
    description: "Technical development and engineering insights",
  },
  {
    id: "product-manager",
    name: "Product Manager",
    icon: LayoutDashboard,
    description: "Product strategy, roadmaps, and feature planning",
  },
  {
    id: "executive",
    name: "Executive",
    icon: Briefcase,
    description: "Strategic leadership and business intelligence",
  },
  {
    id: "sales",
    name: "Sales",
    icon: TrendingUp,
    description: "Sales enablement and revenue insights",
  },
  {
    id: "marketing",
    name: "Marketing",
    icon: Megaphone,
    description: "Marketing strategy and campaign intelligence",
  },
  {
    id: "customer-support",
    name: "Customer Support",
    icon: Headphones,
    description: "Support operations and customer issue resolution",
  },
  {
    id: "customer-success",
    name: "Customer Success",
    icon: Heart,
    description: "Customer retention and success management",
  },
  {
    id: "technical-services",
    name: "Technical Services",
    icon: Wrench,
    description: "Technical implementation and service delivery",
  },
  {
    id: "legal",
    name: "Legal",
    icon: Scale,
    description: "Legal compliance and regulatory intelligence",
  },
  {
    id: "design",
    name: "Design",
    icon: Palette,
    description: "Design systems and user experience insights",
  },
];
