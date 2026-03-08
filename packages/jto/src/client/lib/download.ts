'use client';

export function download(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchorEl = document.createElement('a');
  anchorEl.href = url;
  anchorEl.style.display = 'none';
  anchorEl.download = fileName;
  document.body.appendChild(anchorEl); // Required for this to work in Firefox
  anchorEl.click();
  document.body.removeChild(anchorEl); // Clean up
  URL.revokeObjectURL(url);
}
