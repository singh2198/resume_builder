import unittest
from collections import Counter
import pymupdf as fitz
from layout import inspect_pdf, export_pdf

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

    def test_invalid_permutation_rejected(self):
        raw=self.fixture()
        with fitz.open(stream=raw,filetype='pdf') as doc:
            with self.assertRaises(ValueError):export_pdf(raw,doc,inspect_pdf(doc),[{'group':0,'order':[0,0,1]}])

if __name__=='__main__':unittest.main()
