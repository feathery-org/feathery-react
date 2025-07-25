// Extract package names and URLs imported in the custom component
const extractImports = (code: string) => {
  const lines = code.split('\n');
  const imports = new Set<string>();

  lines.forEach((line) => {
    line = line.trim();
    if (line.startsWith('import')) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (match && match[1] !== 'react') {
        imports.add(match[1]);
      }
    }
  });

  return Array.from(imports);
};

const isValidUrl = (str: string): boolean => {
  try {
    // eslint-disable-next-line no-new
    new URL(str);
    return true;
  } catch {
    return false;
  }
};

// Build an importmap script based on the list of packages imported
const createImportMap = (imports: string[]) => {
  const importEntries = imports.map((importPath) => {
    // Already a full URL, import directly
    if (isValidUrl(importPath)) {
      return `"${importPath}": "${importPath}"`;
    }

    // Default to esm.sh for npm packages
    return `"${importPath}": "https://esm.sh/${importPath}/?external=react"`;
  });

  return `{
  "imports": {
    "react": "https://esm.sh/react@18.2.0",
    "react-dom": "https://esm.sh/react-dom@18.2.0",
    "react-dom/client": "https://esm.sh/react-dom@18.2.0/client",
    "react/jsx-runtime": "https://esm.sh/react@18.2.0/jsx-runtime"${
      imports.length ? ',' : ''
    }
    ${importEntries.join(',\n')}
  }
}`;
};

export const createTemplate = (
  code: string,
  initialValue: string,
  elementId: string
) => `
<!DOCTYPE html>
<html>
  <head>
    <script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.5;
        overflow: hidden;
      }

      #root {
        min-height: 100vh;
        width: 100%;
      }
    </style>
    <script type="importmap">
      ${createImportMap(extractImports(code))}
    </script>
    <script type="module">
      import React from 'react';
      import { createRoot } from 'react-dom/client';

      // Store the elementId for use in postMessage
      window.elementId = '${elementId}';

      (async () => {
        try {
          const transformedCode = Babel.transform(
            \`${code}\`,
            {
              presets: ['react'],
              filename: 'dynamic.jsx'
            }
          ).code;

          // Create a blob URL for the transformed code
          const blob = new Blob([transformedCode], { type: 'text/javascript' });
          const moduleUrl = URL.createObjectURL(blob);

          // Import the component
          const { default: UserComponent } = await import(moduleUrl);

          // Set up the root and store it
          const container = document.getElementById('root');
          const root = createRoot(container);
          window.rootRef = root;

          window.parent.postMessage({ 
            type: 'LOADING_COMPLETE',
            elementId: window.elementId
          }, '*');

          // Handle resize
          const resizeObserver = new ResizeObserver(entries => {
            const height = entries[0].contentRect.height;
            window.parent.postMessage({ 
              type: 'resize', 
              height,
              elementId: window.elementId
            }, '*');
          });
          
          resizeObserver.observe(container);

          // Store references for updates
          window.React = React;
          window.UserComponent = UserComponent;
        } catch (err) {
          console.error('Error:', err);
          window.parent.postMessage({ 
            type: 'error',
            error: \`\${err.name}: \${err.message}\`,
            elementId: window.elementId
          }, '*');
        }
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
