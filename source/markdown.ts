/**
 * Simple markdown renderer that supports basic formatting
 */
export function renderMarkdown(text: string): string {
  try {
    // Simple markdown parsing with ANSI codes
    let result = text;
    
    // Headers
    result = result.replace(/^### (.*$)/gm, '\x1b[1m\x1b[36m$1\x1b[0m'); // Bold cyan
    result = result.replace(/^## (.*$)/gm, '\x1b[1m\x1b[32m$1\x1b[0m'); // Bold green
    result = result.replace(/^# (.*$)/gm, '\x1b[1m\x1b[32m$1\x1b[0m'); // Bold green
    
    // Bold text
    result = result.replace(/\*\*(.*?)\*\*/g, '\x1b[1m$1\x1b[0m');
    
    // Italic text
    result = result.replace(/\*(.*?)\*/g, '\x1b[3m$1\x1b[0m');
    
    // Code blocks (inline)
    result = result.replace(/`(.*?)`/g, '\x1b[90m$1\x1b[0m');
    
    // List items
    result = result.replace(/^- (.*$)/gm, '  • $1');
    result = result.replace(/^\* (.*$)/gm, '  • $1');
    
    return result;
  } catch (error) {
    // If markdown parsing fails, return original text
    return text;
  }
}