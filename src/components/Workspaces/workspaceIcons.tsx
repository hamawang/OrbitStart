import {
  AppWindow,
  Briefcase,
  FileText,
  FolderOpen,
  Globe,
  Settings,
  TerminalSquare,
  Workflow
} from "lucide-react";

export function getStepIcon(type: string) {
  switch (type) {
    case "app": return <AppWindow size={16} className="text-sky-400" />;
    case "website": return <Globe size={16} className="text-teal-400" />;
    case "folder": return <FolderOpen size={16} className="text-green-400" />;
    case "script": return <TerminalSquare size={16} className="text-violet-400" />;
    case "wait": return <Workflow size={16} className="text-gold" />;
    default: return <FileText size={16} className="text-orange-400" />;
  }
}

export function getWorkspaceIcon(name: string, color?: string, size = 20) {
  const style = color ? { color } : undefined;
  switch (name) {
    case "AppWindow": return <AppWindow size={size} style={style} />;
    case "Globe": return <Globe size={size} style={style} />;
    case "FolderOpen": return <FolderOpen size={size} style={style} />;
    case "FileText": return <FileText size={size} style={style} />;
    case "Settings": return <Settings size={size} style={style} />;
    default: return <Briefcase size={size} style={style} />;
  }
}
