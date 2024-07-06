
self.onmessage = async function (e) {
    const { name, buf, width, height, palette, dithering } = e.data;
    const processed = await processImage(buf, width, height, palette, dithering);
    self.postMessage({ name, processed });
};

// Precompute Floyd-Steinberg fractions to avoid repeated division
const f7_16 = 7 / 16;
const f3_16 = 3 / 16;
const f5_16 = 5 / 16;
const f1_16 = 1 / 16;

/**
 * Processes an image using nearest neighbor downscaling and optional dithering.
 * @param {buf} imageDataBuffer - The source image data buffer.
 * @param {number} width - The width of the image.
 * @param {number} height - The height of the image.
 * @param {Array} palette - The color palette for quantization.
 * @param {boolean} dithering - Whether to apply Floyd-Steinberg dithering.
 * @returns {Promise<string>} - A promise that resolves to the processed image URL.
 */
async function processImage(buf, width, height, palette, dithering) {
    // Create a new ImageData for the given buffer
    const src = new ImageData(new Uint8ClampedArray(buf), width, height);
    // Create an OffscreenCanvas for the processed image
    const target = new OffscreenCanvas(width, height);
    const targetCtx = target.getContext('2d', { willReadFrequently: true });
    const dst = targetCtx.createImageData(width, height);
    // Process each pixel in the image
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const r = src.data[i];
            const g = src.data[i + 1];
            const b = src.data[i + 2];
            const closest = closestColor(palette, r, g, b);
            
            // Set the pixel to the closest color from the palette
            dst.data[i] = closest[0];
            dst.data[i + 1] = closest[1];
            dst.data[i + 2] = closest[2];
            dst.data[i + 3] = 255; // Fully opaque

            // Apply Floyd-Steinberg dithering if enabled
            if (dithering) {
                const errR = r - closest[0];
                const errG = g - closest[1];
                const errB = b - closest[2];
                
                // Distribute the error to neighboring pixels
                // RIGHT (x + 1, y)
                if (x + 1 < width) {
                    const idx = i + 4;
                    src.data[idx] += errR * f7_16;
                    src.data[idx + 1] += errG * f7_16;
                    src.data[idx + 2] += errB * f7_16;
                }
                
                // BOTTOM LEFT (x - 1, y + 1)
                if (x > 0 && y + 1 < height) {
                    const idx = i + (width - 1) * 4;
                    src.data[idx] += errR * f3_16;
                    src.data[idx + 1] += errG * f3_16;
                    src.data[idx + 2] += errB * f3_16;
                }

                // BOTTOM (x, y + 1)
                if (y + 1 < height) {
                    const idx = i + width * 4;
                    src.data[idx] += errR * f5_16;
                    src.data[idx + 1] += errG * f5_16;
                    src.data[idx + 2] += errB * f5_16;
                }

                // BOTTOM RIGHT (x + 1, y + 1)
                if (x + 1 < width && y + 1 < height) {
                    const idx = i + (width + 1) * 4;
                    src.data[idx] += errR * f1_16;
                    src.data[idx + 1] += errG * f1_16;
                    src.data[idx + 2] += errB * f1_16;
                }
            }
        }
    }

    targetCtx.putImageData(dst, 0, 0);
    const processed = await target.convertToBlob(); // Use convertToBlob for efficiency
    return processed; // Create an object URL for the blob
}

/**
 * Finds the closest color from the palette to the given color.
 * @param {Array} palette - The flattened color palette.
 * @param {number} r - Red value of the source color.
 * @param {number} g - Green value of the source color.
 * @param {number} b - Blue value of the source color.
 * @returns {Array} - The closest color from the palette.
 */
function closestColor(palette, r, g, b) {
    let minDistance = Infinity;
    let closest = [0, 0, 0];
    for (let i = 0; i < palette.length; i += 3) {
        const pr = palette[i];
        const pg = palette[i + 1];
        const pb = palette[i + 2];
        const distance = colorDistance(r, g, b, pr, pg, pb);
        if (distance < minDistance) {
            minDistance = distance;
            closest = [pr, pg, pb];
        }
    }
    return closest;
}

/**
 * Calculates the Euclidean distance between two colors in RGB space.
 * @param {number} sr - Red value of the source color.
 * @param {number} sg - Green value of the source color.
 * @param {number} sb - Blue value of the source color.
 * @param {number} dr - Red value of the destination color.
 * @param {number} dg - Green value of the destination color.
 * @param {number} db - Blue value of the destination color.
 * @returns {number} - The Euclidean distance between the two colors.
 */
function colorDistance(sr, sg, sb, dr, dg, db) {
    return Math.sqrt(
        Math.pow((sr - dr), 2) +
        Math.pow((sg - dg), 2) +
        Math.pow((sb - db), 2)
    );
}
