import { Text } from "ink";
import hljs from "highlight.js";
import React from "react";

export function HighlightedCode({ code, language }: {
  code: string,
  language?: string,
}) {
  try {
    let result;
    if (language && hljs.getLanguage(language)) {
      result = hljs.highlight(code, { language });
    } else {
      result = hljs.highlightAuto(code);
    }

    const lines = result.value.split('\n');
    return <>
      {
        lines.map((line, index) => {
          const segments = parseHighlightedHTML(line);
          return <CodeLine segments={segments} key={`code-${index}`} />;
        })
      }
    </>;
  } catch (error) {
    // If highlighting fails, return plain text lines
    return <>
      {
        code.split('\n').map((line, index) => (
          <Text key={`code-failed-${index}`}>{line}</Text>
        ))
      }
    </>;
  }
}

type CodeSegment = {
  text: string,
  className?: string,
};

function parseHighlightedHTML(html: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  let currentIndex = 0;

  // Simple state machine to parse HTML
  while (currentIndex < html.length) {
    const nextOpenTag = html.indexOf('<span class="', currentIndex);

    if (nextOpenTag === -1) {
      // No more spans, add remaining text
      const remainingText = html.substring(currentIndex);
      if (remainingText) {
        segments.push({
          text: decodeHtmlEntities(remainingText)
        });
      }
      break;
    }

    // Add any text before the span
    if (nextOpenTag > currentIndex) {
      const textBefore = html.substring(currentIndex, nextOpenTag);
      segments.push({
        text: decodeHtmlEntities(textBefore)
      })
    }

    // Find the end of the opening tag
    const classStart = nextOpenTag + 13; // '<span class="'.length
    const classEnd = html.indexOf('"', classStart);
    const tagEnd = html.indexOf('>', classEnd);

    if (classEnd === -1 || tagEnd === -1) break;

    const className = html.substring(classStart, classEnd);

    // Find the closing tag
    const closingTag = '</span>';
    const contentStart = tagEnd + 1;
    let closingTagStart = html.indexOf(closingTag, contentStart);

    // Handle nested spans by counting open/close tags
    let openCount = 1;
    let searchFrom = contentStart;
    while (openCount > 0 && closingTagStart !== -1) {
      const nextOpen = html.indexOf('<span', searchFrom);
      if (nextOpen !== -1 && nextOpen < closingTagStart) {
        openCount++;
        searchFrom = nextOpen + 5;
      } else {
        openCount--;
        if (openCount > 0) {
          searchFrom = closingTagStart + closingTag.length;
          closingTagStart = html.indexOf(closingTag, searchFrom);
        }
      }
    }

    if (closingTagStart === -1) break;

    const content = html.substring(contentStart, closingTagStart);

    // Recursively parse content for nested spans
    if (content.includes('<span')) {
      const nestedSegments = parseHighlightedHTML(content);
      segments.push(...nestedSegments);
    } else {
      segments.push({
        text: decodeHtmlEntities(content),
        className: className
      });
    }

    currentIndex = closingTagStart + closingTag.length;
  }

  return segments;
}

function CodeLine({ segments }: { segments: CodeSegment[] }) {
  return <Text>
    {segments.map((segment, index) => {
      const color = segment.className ? getColorForClass(segment.className) : undefined;
      return (
        <Text key={index} color={color}>
          {segment.text}
        </Text>
      );
    })}
  </Text>;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function getColorForClass(className: string): string | undefined {
  const colorMap: Record<string, string> = {
    'hljs-keyword': 'blue',
    'hljs-string': 'green',
    'hljs-comment': 'gray',
    'hljs-number': 'yellow',
    'hljs-title': 'cyan',
    'hljs-title function_': 'cyan',
    'hljs-variable': 'magenta',
    'hljs-type': 'blue',
    'hljs-attr': 'yellow',
    'hljs-built_in': 'red',
    'hljs-literal': 'cyan',
    'hljs-name': 'cyan',
    'hljs-selector-tag': 'blue',
    'hljs-selector-class': 'yellow',
    'hljs-selector-id': 'magenta',
    'hljs-property': 'cyan',
    'hljs-value': 'green',
  };

  return colorMap[className];
}
