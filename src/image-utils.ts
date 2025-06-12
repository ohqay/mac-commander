import { Image } from "@nut-tree-fork/nut-js";
import { promises as fs } from "fs";
import { createCanvas, ImageData } from "canvas";
import { Buffer } from "buffer";

export async function imageToBase64(image: Image): Promise<string> {
  try {
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    
    // Convert BGR to RGB and create ImageData
    const rgbImage = await image.toRGB();
    const imageData = ctx.createImageData(rgbImage.width, rgbImage.height);
    
    // Copy pixel data from nut.js Image to canvas ImageData
    // The image data is in RGB format with 3 or 4 channels
    const sourceData = rgbImage.data;
    const destData = imageData.data;
    
    if (rgbImage.channels === 3) {
      // RGB format
      let srcIdx = 0;
      for (let i = 0; i < destData.length; i += 4) {
        destData[i] = sourceData[srcIdx++];     // R
        destData[i + 1] = sourceData[srcIdx++]; // G
        destData[i + 2] = sourceData[srcIdx++]; // B
        destData[i + 3] = 255;                  // A (fully opaque)
      }
    } else if (rgbImage.channels === 4) {
      // RGBA format
      for (let i = 0; i < sourceData.length; i++) {
        destData[i] = sourceData[i];
      }
    }
    
    // Put the image data on the canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Convert to base64
    return canvas.toDataURL('image/png');
  } catch (error) {
    throw new Error(`Failed to convert image to base64: ${error}`);
  }
}

export async function saveImage(image: Image, outputPath: string): Promise<void> {
  try {
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    
    // Convert BGR to RGB and create ImageData
    const rgbImage = await image.toRGB();
    const imageData = ctx.createImageData(rgbImage.width, rgbImage.height);
    
    // Copy pixel data from nut.js Image to canvas ImageData
    const sourceData = rgbImage.data;
    const destData = imageData.data;
    
    if (rgbImage.channels === 3) {
      // RGB format
      let srcIdx = 0;
      for (let i = 0; i < destData.length; i += 4) {
        destData[i] = sourceData[srcIdx++];     // R
        destData[i + 1] = sourceData[srcIdx++]; // G
        destData[i + 2] = sourceData[srcIdx++]; // B
        destData[i + 3] = 255;                  // A (fully opaque)
      }
    } else if (rgbImage.channels === 4) {
      // RGBA format
      for (let i = 0; i < sourceData.length; i++) {
        destData[i] = sourceData[i];
      }
    }
    
    // Put the image data on the canvas
    ctx.putImageData(imageData, 0, 0);
    
    // Save as PNG
    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(outputPath, buffer);
  } catch (error) {
    throw new Error(`Failed to save image: ${error}`);
  }
}

export function base64ToBuffer(base64: string): Buffer {
  // Remove data URI prefix if present
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}