window.pixelizer = () => {
    return {
        image: null,
        downscaleFactor: 2,
        palettes: [],
        currentPalettes: [],
        minColors: 2,
        maxColors: 256,
        selectedPalettes: [],
        processedImages: [],
        processing: false,
        dithering: true,
        modalVisible: false,
        modalImageIndex: 0,
        elapsed: 0,

        async init() {
            const response = await fetch('palettes.json');
            const json = await response.json();
            this.palettes = json.map(p => ({
                name: p.name,
                count: p.count,
                rgb: new Uint8ClampedArray(p.rgb),
                url: `https://lospec.com/palette-list/${p.slug}-1x.png`
            }));
            this.filterPalettes();
        },

        filterPalettes() {
            this.currentPalettes = this.palettes.filter(p => (this.minColors <= p.count && p.count <= this.maxColors));
        },

        handleImageUpload(event) {
            const file = event.target.files[0];
            if (file) {
                const url = URL.createObjectURL(file);
                const image = new Image();
                image.onload = () => {
                    this.image = image;
                };
                image.src = url;
            }
        },

        async processImage() {
            if (!this.image || this.selectedPalettes.length === 0) return;
            // Start timer
            const start = performance.now();
            // Clear the processed images array by cleaning up images and reseting
            this.processedImages.forEach(img => window.URL.revokeObjectURL(img.src));
            this.processedImages = [];
            this.processing = true;
            console.log("Processing...");
            // Capture the values on this run
            const downscaleFactor = this.downscaleFactor;
            const selectedPalettes = Array.from(this.selectedPalettes);
            const currentPalettes = Array.from(this.currentPalettes);
            const dithering = this.dithering;
            // Calculate the target resolution
            const width = Math.floor(this.image.width / downscaleFactor);
            const height = Math.floor(this.image.height / downscaleFactor);
            // Create a target canvas (OffScreen)
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            // Disable image smoothing for nearest neighbor downscaling and draw image to it
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(this.image, 0, 0, width, height);
            // Create an imageData buffer to pass to the worker
            const buf = ctx.getImageData(0, 0, width, height).data.buffer;
            // Create a new worker
            const worker = new Worker("worker.js");
            // Attach an event to get results and process next palette
            worker.onmessage = (e) => {
                const { name, processed } = e.data;
                console.log("Processed: ", name);
                const src = window.URL.createObjectURL(processed);
                this.processedImages.push({ src, palette: currentPalettes[selectedPalettes.shift()] });
                if (selectedPalettes.length === 0) {
                    // Calculate elapsed time and print
                    this.elapsed = ((performance.now() - start)/1000).toFixed(3);
                    console.log(`Processing completed in: ${this.elapsed} [s]`);
                    // If we are done with the palettes, stop processing and terminate worker
                    this.processing = false;
                    // Add a delay before terminating the worker to ensure the last image is fully handled
                    setTimeout(() => worker.terminate(), 1000);
                } else {
                    // Just send the next (current) palette to the worker
                    const palette = currentPalettes[selectedPalettes[0]];
                    worker.postMessage({name: palette.name, buf, width, height, palette: palette.rgb, dithering});
                }
            };
            // Send the initial data and palette to the worker
            const palette = currentPalettes[selectedPalettes[0]];
            worker.postMessage({name: palette.name, buf, width, height, palette: palette.rgb, dithering});
        },

        open(index) {
            this.modalImageIndex = index;
            this.modalVisible = true;
        },

        close() {
            this.modalVisible = false;
        },

        prev() {
            if (this.modalImageIndex > 0) {
                this.modalImageIndex--;
            } else {
                this.modalImageIndex = this.processedImages.length - 1
            }
        },

        next() {
            if (this.modalImageIndex < this.processedImages.length - 1) {
                this.modalImageIndex++;
            } else {
                this.modalImageIndex = 0;
            }
        },

        download() {
            const img = this.processedImages[this.modalImageIndex];
            if (img && img.src) {
                const filename = `${img.src.split('/').pop()}.png`;
                downloadImage(img.src, filename);
            }
        },
    };
};

/**
 * Function to download an image from a given URL.
 * @param {string} url - The URL of the image to download.
 * @param {string} filename - The desired filename for the downloaded image.
 */
function downloadImage(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}