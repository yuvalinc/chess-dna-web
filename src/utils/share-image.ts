/**
 * Image capture and sharing utilities for share cards.
 * html2canvas is dynamically imported to keep the main bundle small.
 */

/** Capture a DOM element as a PNG Blob. Renders at the element's intrinsic
 *  (un-transformed) size so the output is full-resolution even when the live
 *  preview is CSS-scaled down to fit the viewport. */
export async function captureCardAsBlob(element: HTMLElement): Promise<Blob> {
  const html2canvas = (await import('html2canvas')).default;
  // Intrinsic (pre-transform) size. offsetWidth/offsetHeight ignore CSS
  // transforms, so this gives us e.g. 1080×1920 even when the preview is
  // visually scaled to ~420×750.
  const width = element.offsetWidth || element.getBoundingClientRect().width;
  const height = element.offsetHeight || element.getBoundingClientRect().height;
  const canvas = await html2canvas(element, {
    scale: 1,
    width,
    height,
    useCORS: true,
    backgroundColor: null,
    logging: false,
    allowTaint: true,
    onclone: (doc) => {
      // Remove the preview-scale transform from the CLONE html2canvas renders
      // into. The live DOM stays untouched.
      const node = doc.querySelector('[data-share-card]');
      if (node instanceof HTMLElement) {
        node.style.transform = 'none';
        node.style.transformOrigin = 'top left';
      }
    },
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create blob'))),
      'image/png',
      1.0,
    );
  });
}

/** Share an image using the Web Share API (mobile) or fall back to download */
export async function shareImage(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
  } else {
    downloadImage(blob, filename);
  }
}

/** Download a blob as a file */
export function downloadImage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy image to clipboard */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Check if native file sharing is supported */
export function canShareFiles(): boolean {
  try {
    const file = new File([], 'test.png', { type: 'image/png' });
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}
