// Crops a captured-tab data URL to a CSS-pixel rect. Scale factors are derived from
// the actual bitmap size vs. the reported viewport, so zoom and retina both work.
(function (global) {
  async function blobToDataUrl(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return 'data:' + blob.type + ';base64,' + btoa(bin);
  }
  async function cropCapture(dataUrl, rect, viewport, maxSide = 2000) {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const fx = bmp.width / viewport.w, fy = bmp.height / viewport.h;
    const sx = Math.max(0, Math.round(rect.x * fx)), sy = Math.max(0, Math.round(rect.y * fy));
    const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(rect.w * fx)));
    const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(rect.h * fy)));
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    bmp.close && bmp.close();
    const type = w * h > 1500000 ? 'image/jpeg' : 'image/png';
    const out = await canvas.convertToBlob({ type, quality: 0.9 });
    return { dataUrl: await blobToDataUrl(out), mediaType: type, width: w, height: h };
  }
  global.SnapAskCrop = { cropCapture, blobToDataUrl };
})(typeof self !== 'undefined' ? self : globalThis);
