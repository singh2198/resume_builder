import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { pdfEngine, tailorPDF } from './pdf-layout.js';

// Build the exact file before charging; layout errors must never trigger checkout.
export async function buildExport({ body, file }) {
  const { text, format, mode = 'rebuilt', jd, layoutMode } = body;
  if (typeof text !== 'string' || !text.trim() || text.length > 60000)
    throw Error('Resume must contain 1–60,000 characters.');
  if (!['pdf', 'docx', 'txt'].includes(format)) throw Error('Choose PDF, DOCX or TXT.');
  if (!['rebuilt', 'original', 'edited-original'].includes(mode))
    throw Error('Choose a supported resume layout.');
  if (mode !== 'rebuilt') {
    if (
      format !== 'pdf' ||
      !file ||
      typeof jd !== 'string' ||
      jd.trim().length < 20 ||
      jd.length > 60000
    )
      throw Error('Original PDF and job description are required.');
    const { result, orders } = await tailorPDF(file.buffer, jd);
    if (mode === 'original' && text.replace(/\r\n?/g, '\n') !== result.updatedResume)
      throw Error('The draft was edited. Choose the edited original layout.');
    let output = await pdfEngine(file.buffer, 'export', orders);
    if (mode === 'edited-original')
      output = await pdfEngine(Buffer.from(output.pdf, 'base64'), 'edit', [], text);
    return {
      bytes: Buffer.from(output.pdf, 'base64'),
      filename: 'final-resume.pdf',
      type: 'application/pdf',
    };
  }
  if (format === 'pdf' && (layoutMode === true || layoutMode === 'true'))
    throw Error('Re-upload the original PDF to preserve its formatting.');
  const filename = `tailored-resume.${format}`;
  if (format === 'txt') return { bytes: Buffer.from(text), filename, type: 'text/plain' };
  if (format === 'docx') {
    const document = new Document({
      sections: [
        {
          children: text.split('\n').map(
            (line) =>
              new Paragraph({
                children: [new TextRun({ text: line, font: 'Calibri', size: 22 })],
                spacing: { after: 100 },
              }),
          ),
        },
      ],
    });
    return {
      bytes: await Packer.toBuffer(document),
      filename,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  const bytes = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica').fontSize(10.5).text(text, { lineGap: 4 });
    doc.end();
  });
  return { bytes, filename, type: 'application/pdf' };
}
