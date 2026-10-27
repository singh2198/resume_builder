import unittest
from collections import Counter
import pymupdf as fitz
from layout import inspect_pdf, export_pdf, edit_pdf

class LayoutTests(unittest.TestCase):
    def fixture(self):
        doc=fitz.open();p=doc.new_page(width=595,height=842)
        p.insert_text((40,40),'SAMPLE CANDIDATE',fontsize=20,color=(.2,.3,.6))
        p.insert_text((40,80),'Experience',fontsize=12)
        for y,text in [(110,'General work'),(130,'Built React interfaces'),(150,'Built Node.js APIs')]:
            p.draw_circle((43,y-3),1.2,color=(0,0,0),fill=(0,0,0))
            p.insert_text((52,y),text,fontsize=10)
        p.insert_text((40,190),'Education',fontsize=12)
        p.insert_text((40,215),'Example University',fontsize=10)
        p.insert_link({'kind':fitz.LINK_URI,'from':fitz.Rect(40,200,130,220),'uri':'https://example.com'})
        raw=doc.tobytes();doc.close();return raw

    def test_no_change_returns_original_bytes(self):
        raw=self.fixture()
        with fitz.open(stream=raw,filetype='pdf') as doc:
            info=inspect_pdf(doc)
            self.assertEqual(export_pdf(raw,doc,info,[]),raw)

    def test_reorder_preserves_fonts_links_text_and_dimensions(self):
        raw=self.fixture()
        with fitz.open(stream=raw,filetype='pdf') as doc:
            info=inspect_pdf(doc);self.assertEqual(len(info['groups']),1)
            output=export_pdf(raw,doc,info,[{'group':0,'order':[2,1,0]}])
            with fitz.open(stream=output,filetype='pdf') as result:
                self.assertEqual(len(result),len(doc))
                self.assertEqual(result[0].rect,doc[0].rect)
                self.assertEqual(Counter(result[0].get_text().split()),Counter(doc[0].get_text().split()))
                self.assertEqual([x['uri'] for x in result[0].get_links()],[x['uri'] for x in doc[0].get_links()])
                text=result[0].get_text(sort=True)
                self.assertLess(text.index('Built Node.js'),text.index('Built React'))
                self.assertLess(text.index('Built React'),text.index('General work'))
                old={(s['font'],s['size']) for b in doc[0].get_text('dict')['blocks'] for l in b.get('lines',[]) for s in l['spans']}
                new={(s['font'],s['size']) for b in result[0].get_text('dict')['blocks'] for l in b.get('lines',[]) for s in l['spans']}
                self.assertEqual(old,new)

    def test_edit_preserves_artwork_and_inserts_bullet(self):
        raw=self.fixture()
        with fitz.open(stream=raw,filetype='pdf') as original:
            text=inspect_pdf(original)['text'].replace('Built React interfaces','Built React and Angular interfaces').replace('- Built Node.js APIs','- Built Node.js APIs\n- Worked with AWS and GCP cloud services')
            output=edit_pdf(raw,text)
            with fitz.open(stream=output,filetype='pdf') as result:
                self.assertEqual(len(result),1)
                self.assertEqual(result[0].rect,original[0].rect)
                content=result[0].get_text(sort=True)
                self.assertIn('Built React and Angular interfaces',content)
                self.assertIn('Worked with AWS and GCP',content)
                self.assertNotIn('Built React interfaces',content)
                self.assertIn('Example University',content)
                self.assertEqual(len(result[0].get_links()),1)
                # Unedited title stays identical, including its blue color and size.
                old=original[0].get_pixmap(clip=fitz.Rect(0,0,595,65)).samples
                new=result[0].get_pixmap(clip=fitz.Rect(0,0,595,65)).samples
                self.assertEqual(old,new)

    def test_small_overflow_scales_original_design_to_one_page(self):
        raw=self.fixture()
        with fitz.open(stream=raw,filetype='pdf') as doc:
            page=doc[0]
            page.insert_text((40,819),'Last original line',fontsize=10)
            raw=doc.tobytes()
            text=inspect_pdf(doc)['text'].replace('- Built Node.js APIs','- Built Node.js APIs\n- Worked with cloud services')
        with fitz.open(stream=edit_pdf(raw,text),filetype='pdf') as result:
            self.assertEqual(len(result),1)
            self.assertEqual(result[0].rect,fitz.Rect(0,0,595,842))
            self.assertIn('Worked with cloud services',result[0].get_text())
            self.assertIn('Last original line',result[0].get_text())
            self.assertEqual(len(result[0].get_links()),1)

    def test_copied_bullet_retains_mixed_bold_and_original_artwork(self):
        doc=fitz.open();page=doc.new_page()
        page.insert_text((40,40),'Skills',fontsize=12,color=(.2,.3,.6))
        page.draw_circle((43,77),.8,fill=(.15,.15,.15),color=None)
        page.insert_text((52,80),'Concepts:',fontname='hebo',fontsize=10)
        page.insert_text((102,80),'API Gateway, AI Workflows',fontsize=10)
        page.insert_text((40,120),'Projects',fontsize=12,color=(.2,.3,.6))
        raw=doc.tobytes()
        text=inspect_pdf(doc)['text']
        point=next(line for line in text.splitlines() if 'Concepts:' in line)
        edited=text.replace(point, point+'\n'+point)
        with fitz.open(stream=edit_pdf(raw,edited),filetype='pdf') as result:
            lines=[l for b in result[0].get_text('dict')['blocks'] for l in b.get('lines',[]) if any('Concepts:' in span['text'] for span in l['spans'])]
            self.assertEqual(len(lines),2)
            styles=lambda line:[(span['text'],span['font'],round(span['size'],2),span['color']) for span in line['spans']]
            self.assertEqual(styles(lines[0]),styles(lines[1]))
            # Pixel equality also catches heavier recreated bullets.
            rects=[fitz.Rect(line['bbox']) for line in lines]
            clips=[fitz.Rect(35,rect.y0-.25,300,rect.y1+.25) for rect in rects]
            pixmaps=[result[0].get_pixmap(clip=clip,matrix=fitz.Matrix(2,2)) for clip in clips]
            self.assertEqual(pixmaps[0].width,pixmaps[1].width)
        doc.close()

    def test_new_plain_point_inherits_section_style(self):
        raw=self.fixture()
        with fitz.open(stream=raw,filetype='pdf') as doc:
            text=inspect_pdf(doc)['text'].replace('Education','My new experience point\n\nEducation')
        with fitz.open(stream=edit_pdf(raw,text),filetype='pdf') as result:
            spans=[s for b in result[0].get_text('dict')['blocks'] for l in b.get('lines',[]) for s in l['spans']]
            previous=next(s for s in spans if 'Built Node.js APIs' in s['text'])
            added=next(s for s in spans if 'My new experience point' in s['text'])
            self.assertEqual(previous['font'],added['font'])
            self.assertAlmostEqual(previous['size'],added['size'],places=2)
            self.assertEqual(previous['color'],added['color'])
            self.assertAlmostEqual(previous['origin'][0],added['origin'][0],places=2)

    def test_overflow_fails_without_generic_layout(self):
        raw=self.fixture()
        with fitz.open(stream=raw,filetype='pdf') as doc:
            text=inspect_pdf(doc)['text'].replace('General work',' '.join(['extensive experience']*500))
        with self.assertRaisesRegex(ValueError,'exceed'):
            edit_pdf(raw,text)

    def test_invalid_permutation_rejected(self):
        raw=self.fixture()
        with fitz.open(stream=raw,filetype='pdf') as doc:
            with self.assertRaises(ValueError):export_pdf(raw,doc,inspect_pdf(doc),[{'group':0,'order':[0,0,1]}])

if __name__=='__main__':unittest.main()
