import sharp from "sharp";
import Tesseract from "tesseract.js";
import { env } from "../config/env";

const OCR_MAX_DIMENSION = 1_800;

let workerPromise: Promise<Tesseract.Worker> | null = null;
let recognitionQueue: Promise<void> = Promise.resolve();

export const prepareOcrImage = async (input: Buffer) => sharp(input, {
  failOn: "error",
  limitInputPixels: 40_000_000
})
  .resize({
    width: OCR_MAX_DIMENSION,
    height: OCR_MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true
  })
  .grayscale()
  .normalize()
  .sharpen({ sigma: 1 })
  .png({ compressionLevel: 3 })
  .toBuffer();

const getOcrWorker = () => {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker(env.OCR_LANG)
      .then(async (worker) => {
        await worker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
          preserve_interword_spaces: "1"
        });
        return worker;
      })
      .catch((error) => {
        workerPromise = null;
        throw error;
      });
  }
  return workerPromise;
};

const discardOcrWorker = async () => {
  const activeWorker = workerPromise;
  workerPromise = null;
  if (!activeWorker) return;
  try {
    await (await activeWorker).terminate();
  } catch {
    // O worker já pode ter encerrado por causa da falha original.
  }
};

export const warmOcrWorker = async () => {
  await getOcrWorker();
};

export const recognizeEvidenceImage = async (input: Buffer) => {
  const preparedImage = await prepareOcrImage(input);
  const recognition = recognitionQueue.then(async () => {
    const worker = await getOcrWorker();
    try {
      return await worker.recognize(preparedImage, {}, { text: true });
    } catch (error) {
      await discardOcrWorker();
      throw error;
    }
  });
  recognitionQueue = recognition.then(() => undefined, () => undefined);
  return recognition;
};

export const terminateOcrWorker = async () => {
  await recognitionQueue;
  await discardOcrWorker();
  recognitionQueue = Promise.resolve();
};
