
self.onmessage = async function (e) {
    const { name, buffer, width, height, palette, dithering, upscale, factor } = e.data;
    //console.log(name, width, height, dithering, upscale, factor);
    const processed = await processImage(buffer, width, height, palette, dithering, upscale, factor);
    self.postMessage({ name, processed });
};

// Precomputed offsets for each dithering kernel
const kernels = {
    // Atkinson (1/8)
    // |		*	1	1	|
    // |	1	1	1		|
    // |		1			|
    Atkinson: [
        [1, 0, 1 / 8], [2, 0, 1 / 8],
        [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8],
        [0, 2, 1 / 8],
    ],
    // Burkes (1/32)
    // |			*	8	4	|
    // |	2	4	8	4	2	|
    Burkes: [
        [1, 0, 8 / 32], [2, 0, 4 / 32],
        [-2, 1, 2 / 32], [-1, 1, 4 / 32], [0, 1, 8 / 32], [1, 1, 4 / 32], [2, 1, 2 / 32],
    ],
    // Floyd-Steinberg (1/16)
    // |		*	7	|
    // |	3	5	1	|
    FloydSteinberg: [
        [1, 0, 7 / 16], 
        [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16],
    ],
    // Jarvis, Judice and Ninke (1/48)
    // |			*	7	5	|
    // |	3	5	7	5	3	|
    // |	1	3	5	3	1	|
    JarvisJudiceNinke: [
        [1, 0, 7 / 48], [2, 0, 5 / 48],
        [-2, 1, 3 / 48], [-1, 1, 5 / 48], [0, 1, 7 / 48], [1, 1, 5 / 48], [2, 1, 3 / 48],
        [-2, 2, 1 / 48], [-1, 2, 3 / 48], [0, 2, 5 / 48], [1, 2, 3 / 48], [2, 2, 1 / 48],
    ],
    // Shiau-Fan (1/16)
    // |			*	7	1	|
    // |	3	5	7	5	3	|
    ShiauFan: [
        [1, 0, 7 / 16], [2, 0, 1 / 16],
        [-2, 1, 3 / 16], [-1, 1, 5 / 16], [0, 1, 7 / 16], [1, 1, 5 / 16], [2, 1, 3 / 16],
    ],
    // Sierra (1/32)
    // |			*	5	3	|
    // |	2	4	5	4	2	|
    // |		2	3	2		|
    Sierra: [
        [1, 0, 5 / 32], [2, 0, 3 / 32],
        [-2, 1, 2 / 32], [-1, 1, 4 / 32], [0, 1, 5 / 32], [1, 1, 4 / 32], [2, 1, 2 / 32],
        [-1, 2, 2 / 32], [0, 2, 3 / 32], [1, 2, 2 / 32],
    ],
    // Sierra Lite (1/4)
    // |		*	2	|
    // |	1	1		|
    SierraLite: [
        [1, 0, 2 / 4],
        [-1, 1, 1 / 4], [0, 1, 1 / 4],
    ],
    // Two-Row Sierra (1/16)
    // |			*	4	3	|
    // |	1	2	3	2	1	|
    SierraTwoRow: [
        [1, 0, 4 / 16], [2, 0, 3 / 16],
        [-2, 1, 1 / 16], [-1, 1, 2 / 16], [0, 1, 3 / 16], [1, 1, 2 / 16], [2, 1, 1 / 16],
    ],
    // Stevenson-Arce (1/200)
    // |				*	32	|
    // |	12	26	30	16	4	|
    // |	—	12	26	12	—	|
    StevensonArce: [
        [1, 0, 32 / 200],
        [-3, 1, 12 / 200], [-2, 1, 26 / 200], [-1, 1, 30 / 200], [0, 1, 16 / 200], [1, 1, 4 / 200],
        [-2, 2, 12 / 200], [-1, 2, 26 / 200], [0, 2, 12 / 200],
    ],
    // Stucki (1/42)
    // |			*	8	4	|
    // |	2	4	8	4	2	|
    // |	1	2	4	2	1	|
    Stucki: [
        [1, 0, 8 / 42], [2, 0, 4 / 42],
        [-2, 1, 2 / 42], [-1, 1, 4 / 42], [0, 1, 8 / 42], [1, 1, 4 / 42], [2, 1, 2 / 42],
        [-2, 2, 1 / 42], [-1, 2, 2 / 42], [0, 2, 4 / 42], [1, 2, 2 / 42], [2, 2, 1 / 42],
    ]
};

/**
 * Processes an image using nearest neighbor downscaling and optional dithering.
 * @param {buffer} imageDataBuffer - The source image data buffer.
 * @param {number} width - The width of the image.
 * @param {number} height - The height of the image.
 * @param {Array} palette - The color palette for quantization.
 * @param {string} dithering - Kernel used to apply dithering.
 * @param {boolean} upscale - Whether to upscale image back to original resolution.
 * @param {number} factor - Downscale factor used on the original image (used for upscaling).
 * @returns {Promise<string>} - A promise that resolves to the processed image URL.
 */
async function processImage(buffer, width, height, palette, dithering, upscale, factor) {
    // Create a new ImageData for the given buffer
    const src = new ImageData(new Uint8ClampedArray(buffer), width, height);
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

            // Apply dithering if enabled
            if (dithering) {
                const kernel = kernels[dithering];
                const errR = r - closest[0];
                const errG = g - closest[1];
                const errB = b - closest[2];
                let nx, ny;
                // Distribute the error to neighboring pixels
                for (const offset of kernel) {
                    const [offX, offY, errF] = offset;
                    nx = x + offX;
                    ny = y + offY;
                    // Validate that the new coordinates are within the bounds
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                        continue;
                    }
                    // Calculate the current pixel index + offset
                    const idx = ((ny * width) + nx) * 4;
                    src.data[idx] = clampColor(src.data[idx] + errR * errF);
                    src.data[idx + 1] = clampColor(src.data[idx + 1] + errG * errF);
                    src.data[idx + 2] = clampColor(src.data[idx + 2] + errB * errF);
                }
                // Function to ensure color values remain in the valid range 0-255
                function clampColor(value) {
                    return Math.max(0, Math.min(255, value));
                }
            }
        }
    }

    targetCtx.putImageData(dst, 0, 0);
    let processed = null;
    if (upscale) {
        const upscaled = new OffscreenCanvas(width * factor, height * factor);
        const ctx = upscaled.getContext("2d", { willReadFrequently: true });
        // Disable image smoothing for nearest neighbor upscaling and draw image to it
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(target, 0, 0, width * factor, height * factor);
        processed = await upscaled.convertToBlob();
    } else {
        processed = await target.convertToBlob();
    }
    return processed; // return processed blob
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
