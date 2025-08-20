import { renderMarkdown } from "../../source/markdown.ts";

const demoMarkdown = `# Markdown Rendering Demo

This demonstrates all the **beautiful** markdown rendering features with *aesthetic* terminal output.

## Headings at Different Levels

### Third Level Heading
#### Fourth Level Heading
##### Fifth Level Heading
###### Sixth Level Heading

## Text Formatting

Here's some **bold text** and *italic text* and ~~strikethrough text~~.

You can also have **bold with *nested italic* text** for complex formatting.

## Code Examples

Inline code like \`npm install\` is highlighted with inverse colors.

### Code Blocks with Languages

\`\`\`javascript
function greetUser(name) {
  console.log(\`Hello, \${name}!\`);
  return {
    message: "Welcome to our app",
    timestamp: new Date().toISOString()
  };
}

greetUser("Alice");
\`\`\`

\`\`\`bash
# Install dependencies
npm install

# Run the application
npm start

# Run tests
npm test
\`\`\`

\`\`\`python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

# Generate first 10 Fibonacci numbers
for i in range(10):
    print(f"F({i}) = {fibonacci(i)}")
\`\`\`

### Code Block without Language

\`\`\`
This is plain code
without syntax highlighting
but still nicely formatted
\`\`\`

## Lists

### Unordered Lists

- First item with **bold** text
- Second item with *italic* text
- Third item with \`inline code\`
  - Nested item one
  - Nested item two
- Fourth item with [a link](https://example.com)

### Ordered Lists

1. First numbered item
2. Second numbered item with **formatting**
3. Third numbered item
   - Mixed with unordered
   - Another nested item
4. Fourth numbered item

### Task Lists

- [ ] Todo item not completed
- [x] Completed task item
- [ ] Another todo with *italic* text
- [x] Done task with **bold** text

## Links and Images

Here's a [link to GitHub](https://github.com) and here's an ![example image](https://example.com/image.png).

You can also have [links with **bold text**](https://example.com/bold) inside them.

## Blockquotes

> This is a blockquote with important information.
> 
> It can span multiple lines and contain **formatted text** and \`code\`.
>
> > Nested blockquotes are also supported
> > with proper indentation.

## Tables

| Feature | Status | Description |
|---------|--------|-------------|
| **Headings** | ✅ | Colorful with different symbols |
| *Formatting* | ✅ | Bold, italic, strikethrough |
| \`Code\` | ✅ | Syntax highlighting boxes |
| Links | ✅ | Blue underlined with URLs |
| Tables | ✅ | Clean borders and formatting |

## Horizontal Rules

Here's some content above.

---

And here's content below the horizontal rule.

## Complex Mixed Content

This section combines multiple elements:

### Example: Setting Up a Project

1. **Initialize** the project:
   \`\`\`bash
   mkdir my-project
   cd my-project
   npm init -y
   \`\`\`

2. **Install** dependencies:
   - Run \`npm install express\` for the web server
   - Run \`npm install --save-dev typescript\` for TypeScript

3. **Create** your main file:
   \`\`\`typescript
   import express from 'express';
   
   const app = express();
   const PORT = process.env.PORT || 3000;
   
   app.get('/', (req, res) => {
     res.json({ message: 'Hello, World!' });
   });
   
   app.listen(PORT, () => {
     console.log(\`Server running on port \${PORT}\`);
   });
   \`\`\`

4. **Configure** TypeScript:
   > Create a \`tsconfig.json\` file with your compiler options.
   > Make sure to set \`"target": "ES2020"\` for modern features.

5. **Deploy** when ready:
   - [ ] Test locally with \`npm start\`
   - [ ] Run tests with \`npm test\`
   - [x] Deploy to production

## Final Notes

This demo shows the **complete range** of markdown rendering capabilities with:

- 🎨 **Beautiful colors** for different element types
- 📦 **Code blocks** with elegant borders
- 📝 **Proper formatting** that's easy to read
- 🔗 **Links** and images with clear indicators
- 📊 **Tables** with clean structure
- 💬 **Blockquotes** with distinctive styling

The output is optimized for terminal display with *great contrast* and **readability**!
`;

console.log("🎨 Markdown Rendering Demo");
console.log("=" .repeat(50));
console.log();

const rendered = renderMarkdown(demoMarkdown);
console.log(rendered);

console.log("=" .repeat(50));
console.log("✨ Demo complete! All markdown features rendered above.");