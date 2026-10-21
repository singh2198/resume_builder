"""Preserve existing PDF artwork while reordering safe, contiguous bullet bands.
JSON stdin/stdout protocol; documents never go to disk. No text is regenerated.
"""
import base64, json, re, sys
import pymupdf as fitz


def inspect_pdf(doc):
    groups, texts = [], []
    if len(doc) > 10:
        raise ValueError('Original-layout mode supports resumes up to 10 pages.')
    for page_number, page in enumerate(doc):
        if page.rotation:
            raise ValueError('Rotate pages to upright before using original-layout mode.')
        rows = []
        seen = set()
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                text = ''.join(s['text'] for s in line['spans']).strip()
                if not text:
                    continue
                rect = fitz.Rect(line['bbox'])
                key = (text, round(rect.x0, 1), round(rect.y0, 1))
                if key in seen:  # shadowed title is drawn twice
                    continue
                seen.add(key)
                rows.append({'text':text, 'rect':list(rect), 'size':max(s['size'] for s in line['spans'])})
        rows.sort(key=lambda r:(round(r['rect'][1], 0), r['rect'][0]))
        # Combine fragments on the same visual row (e.g. education dates).
        merged = []
        for row in rows:
            if merged and abs(row['rect'][1]-merged[-1]['rect'][1])<2 and row['rect'][0]>=merged[-1]['rect'][2]-1:
                last=merged[-1]
                last['split'] = last.get('split',False) or row['rect'][0]-last['rect'][2]>45
                last['text'] += '  '+row['text']
                last['rect']=list(fitz.Rect(last['rect'])|fitz.Rect(row['rect']))
            else:
                merged.append(row)
        rows=merged
        dots=[d['rect'] for d in page.get_drawings() if d.get('fill') is not None and 1<=d['rect'].width<=4 and 1<=d['rect'].height<=4]
        for row in rows:
            r=fitz.Rect(row['rect'])
            row['bullet']=bool(re.match(r'^[•●▪\-*]\s+',row['text'])) or any(3<=r.x0-d.x1<=16 and r.y0<=(d.y0+d.y1)/2<=r.y1 for d in dots)
        units=[]
        for row in rows:
            # A continuation must share indentation and body size, be close, and
            # not be a two-column row or a differently styled section heading.
            prev=units[-1] if units else None
            if not row['bullet'] and prev and prev['bullet'] and not row.get('split') and abs(row['rect'][0]-prev['rect'][0])<2 and abs(row['size']-prev['size'])<.3 and 0<=row['rect'][1]-prev['rect'][3]<7:
                prev['text']+=' '+row['text'];prev['rect'][3]=row['rect'][3]
            else:
                units.append(dict(row))
        i=0
        while i<len(units):
            u=units[i]
            if not u['bullet'] or u.get('split'):
                texts.append(u['text']);texts.append('');i+=1;continue
            start=i;end=i+1
            while end<len(units) and units[end]['bullet'] and not units[end].get('split') and abs(units[end]['rect'][0]-u['rect'][0])<2 and units[end]['rect'][1]-units[end-1]['rect'][3]<10:
                end+=1
            bullets=units[start:end]
            for b in bullets:texts.append('- '+re.sub(r'^[•●▪\-*]\s+','',b['text']))
            texts.append('')
            if len(bullets)>1:
                # Cut only through whitespace. Keep all original row spacing.
                top=(units[start-1]['rect'][3]+u['rect'][1])/2 if start else max(0,u['rect'][1]-2)
                bottom=(bullets[-1]['rect'][3]+units[end]['rect'][1])/2 if end<len(units) else min(page.rect.height,bullets[-1]['rect'][3]+2)
                cuts=[top]+[(a['rect'][3]+b['rect'][1])/2 for a,b in zip(bullets,bullets[1:])]+[bottom]
                if all(cuts[k]<bullets[k]['rect'][1] and cuts[k+1]>bullets[k]['rect'][3] for k in range(len(bullets))):
                    groups.append({'page':page_number,'top':top,'bottom':bottom,'bullets':[{'text':b['text'],'top':cuts[k],'bottom':cuts[k+1]} for k,b in enumerate(bullets)]})
            i=end
    return {'text':'\n'.join(texts).strip(),'groups':groups,'pageCount':len(doc)}


def export_pdf(raw, doc, info, orders):
    changed={}
    for entry in orders:
        index=entry['group'];g=info['groups'][index];order=entry['order']
        if sorted(order)!=list(range(len(g['bullets']))):raise ValueError('Invalid bullet ordering.')
        if order!=list(range(len(order))):changed.setdefault(g['page'],[]).append((g,order))
    if not changed:return raw
    result=fitz.open()
    for number,source in enumerate(doc):
        if number not in changed:
            result.insert_pdf(doc,from_page=number,to_page=number);continue
        target=result.new_page(width=source.rect.width,height=source.rect.height)
        bands=[];cursor=0
        for g,order in sorted(changed[number],key=lambda x:x[0]['top']):
            if g['top']>cursor:bands.append((cursor,g['top'],cursor))
            destination=g['top']
            for index in order:
                b=g['bullets'][index];bands.append((b['top'],b['bottom'],destination));destination+=b['bottom']-b['top']
            cursor=g['bottom']
        if cursor<source.rect.height:bands.append((cursor,source.rect.height,cursor))
        for top,bottom,destination in bands:
            clip=fitz.Rect(0,top,source.rect.width,bottom)
            piece=fitz.open();piece.insert_pdf(doc,from_page=number,to_page=number,links=False)
            # Physically remove outside content before embedding. A clip alone
            # would leave hidden duplicate text in every band for ATS readers.
            piece[0].clip_to_rect(clip)
            target.show_pdf_page(fitz.Rect(0,destination,source.rect.width,destination+bottom-top),piece,0,clip=clip)
            piece.close()
        for link in source.get_links():
            if link['kind']!=fitz.LINK_URI:continue
            rect=fitz.Rect(link['from']);center=(rect.y0+rect.y1)/2
            shift=next((dest-top for top,bottom,dest in bands if top<=center<bottom),0)
            rect.y0+=shift;rect.y1+=shift
            target.insert_link({'kind':fitz.LINK_URI,'from':rect,'uri':link['uri']})
    result.set_metadata(doc.metadata)
    output=result.tobytes(garbage=4,deflate=True);result.close();return output


def main():
    request=json.load(sys.stdin);raw=base64.b64decode(request['pdf'],validate=True)
    with fitz.open(stream=raw,filetype='pdf') as doc:
        if doc.needs_pass:raise ValueError('Password-protected PDFs are not supported.')
        info=inspect_pdf(doc)
        if request.get('action') in ('export','preview'):
            pdf=export_pdf(raw,doc,info,request.get('orders',[]))
            if request.get('action')=='preview':
                with fitz.open(stream=pdf,filetype='pdf') as rendered:
                    pages=[{'image':base64.b64encode(p.get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False).tobytes('png')).decode()} for p in rendered]
                print(json.dumps({'pages':pages}))
            else:print(json.dumps({'pdf':base64.b64encode(pdf).decode()}))
        else:print(json.dumps(info))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'error':str(error)}));sys.exit(1)
