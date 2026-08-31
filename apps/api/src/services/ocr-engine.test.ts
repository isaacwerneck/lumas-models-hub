import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

const tesseractMocks = vi.hoisted(() => ({
  createWorker: vi.fn(),
  recognize: vi.fn(),
  setParameters: vi.fn(),
  terminate: vi.fn()
}));

vi.mock("tesseract.js", () => ({
  default: {
    createWorker: tesseractMocks.createWorker,
    PSM: { SPARSE_TEXT: "11" }
  }
}));

import { prepareOcrImage, recognizeEvidenceImage, terminateOcrWorker } from "./ocr-engine";

const makeImage = (width: number, height: number) => sharp({
  create: { width, height, channels: 3, background: "#f4f4f4" }
}).png().toBuffer();

describe("motor de OCR", () => {
  afterEach(async () => {
    await terminateOcrWorker();
    vi.clearAllMocks();
  });

  it("reduz e prepara uma cópia da imagem sem alterar o comprovante armazenado", async () => {
    const input = await makeImage(2_400, 1_200);
    const prepared = await prepareOcrImage(input);
    const metadata = await sharp(prepared).metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(1_800);
    expect(metadata.height).toBe(900);
    expect(prepared).not.toEqual(input);
  });

  it("reutiliza o mesmo worker entre reconhecimentos", async () => {
    tesseractMocks.recognize.mockResolvedValue({ data: { text: "R$ 123,45", confidence: 95 } });
    tesseractMocks.createWorker.mockResolvedValue({
      recognize: tesseractMocks.recognize,
      setParameters: tesseractMocks.setParameters,
      terminate: tesseractMocks.terminate
    });
    const input = await makeImage(320, 180);

    await recognizeEvidenceImage(input);
    await recognizeEvidenceImage(input);

    expect(tesseractMocks.createWorker).toHaveBeenCalledTimes(1);
    expect(tesseractMocks.setParameters).toHaveBeenCalledWith(expect.objectContaining({ tessedit_pageseg_mode: "11" }));
    expect(tesseractMocks.recognize).toHaveBeenCalledTimes(2);
  });
});
