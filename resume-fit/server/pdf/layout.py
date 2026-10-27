"""Preserve existing PDF artwork while reordering safe, contiguous bullet bands.
JSON stdin/stdout protocol; documents never go to disk. No text is regenerated.
"""
import base64, json, re, sys
from difflib import SequenceMatcher
import pymupdf as fitz


def inspect_pdf(doc):
    groups, texts, segments = [], [], []
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
                rows.append({'text':text, 'rect':list(rect), 'style':max(line['spans'], key=lambda s:len(s['text'])), 'size':max(s['size'] for s in line['spans'])})
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
        for unit in units:
            unit['page'] = page_number
            unit['text'] = ('- '+re.sub(r'^[•●▪\-*]\s+', '', unit['text'])) if unit['bullet'] else unit['text']
            segments.append(unit)
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
    return {'text':'\n'.join(texts).strip(),'groups':groups,'pageCount':len(doc),'segments':segments}


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


def edit_pdf(raw, text):
    """Reflow changed text bands; retain unchanged PDF artwork and links."""
    with fitz.open(stream=raw, filetype='pdf') as source:
        info = inspect_pdf(source)
        units = info['segments']
        before = [u['text'] for u in units]
        after = [line.strip() for line in text.replace('\r', '').split('\n') if line.strip()]
        if before == after: return raw
        changes = {}
        for tag, a, b, c, d in SequenceMatcher(None, before, after, autojunk=False).get_opcodes():
            if tag == 'equal': continue
            anchor = min(a, len(units)-1)
            page_number = units[anchor]['page']
            if b > a and any(u['page'] != page_number for u in units[a:b]):
                raise ValueError('Edit one page at a time to preserve the original design.')
            page_units = [u for u in units if u['page'] == page_number]
            first = units[anchor]
            if b > a:
                last = units[b-1]
                top = first['rect'][1]-1
                bottom = last['rect'][3]+1
            else:
                top = bottom = first['rect'][1]-2
            if a == len(units):
                first = units[-1]; top = bottom = first['rect'][3]+3
            if b > a and any(u.get('split') for u in units[a:b]):
                raise ValueError('This edit changes a multi-column row. Edit a single-column section to preserve its alignment.')
            # Inserting a bullet at a section boundary inherits the previous bullet style.
            style_unit = first
            if c < d and a > 0 and units[a-1]['page'] == page_number and (units[a-1]['bullet'] or (a == b and not first['bullet'])):
                style_unit = units[a-1]
                if a == b: top = bottom = style_unit['rect'][3]+2
            changes.setdefault(page_number, []).append((top, bottom, after[c:d], style_unit))
        result = fitz.open()
        heights = {}
        for number, page in enumerate(source):
            if number not in changes:
                result.insert_pdf(source, from_page=number, to_page=number); continue
            target = result.new_page(width=page.rect.width, height=page.rect.height*4)
            bands = []; cursor = destination = 0
            for top, bottom, lines, unit in sorted(changes[number], key=lambda x:x[0]):
                if top < cursor: raise ValueError('These edits overlap. Please edit smaller sections.')
                if top > cursor:
                    bands.append((cursor, top, destination)); destination += top-cursor
                if lines:
                    style = unit['style']; size = style['size']
                    fontname = style['font']; font = None
                    resource_name = 'edited' + str(len(target.get_fonts()))
                    for item in page.get_fonts(full=True):
                        if re.sub(r'^[A-Z]{6}\+', '', item[3]).replace(' ', '') == fontname.replace(' ', ''):
                            data = source.extract_font(item[0])[3]
                            if data:
                                font = fitz.Font(fontbuffer=data); target.insert_font(fontname=resource_name, fontbuffer=data)
                                break
                    if font is None:
                        flags = style.get('flags', 0)
                        base = ('Times' if flags & 4 else 'Helvetica')
                        if base == 'Times': base = 'Times-BoldItalic' if flags & 16 and flags & 2 else 'Times-Bold' if flags & 16 else 'Times-Italic' if flags & 2 else 'Times-Roman'
                        else: base = 'Helvetica-BoldOblique' if flags & 16 and flags & 2 else 'Helvetica-Bold' if flags & 16 else 'Helvetica-Oblique' if flags & 2 else 'Helvetica'
                        font = fitz.Font(base); resource_name = base; target.insert_font(fontname=resource_name)
                    x = unit['rect'][0]
                    right = max(u['rect'][2] for u in info['segments'] if u['page']==number)
                    color = fitz.sRGB_to_pdf(style['color'])
                    baseline_offset = style['origin'][1] - style['bbox'][1]
                    line_height = size*1.25
                    baseline = destination + baseline_offset
                    for line in lines:
                        # Copy matching source artwork instead of repainting plain text.
                        # This retains mixed font weights, bullet geometry and colors.
                        canonical = lambda value: re.sub(r'\s+', '', re.sub(r'^[-•●▪*]\s*', '', value))
                        copied = next((u for u in units if not u.get('split') and canonical(u['text']) == canonical(line)), None)
                        if copied:
                            source_page = source[copied['page']]
                            bounds = fitz.Rect(copied['rect'])
                            clip = fitz.Rect(0, bounds.y0-.25, source_page.rect.width, bounds.y1+.25)
                            y = baseline-baseline_offset
                            piece = fitz.open()
                            piece.insert_pdf(source, from_page=copied['page'], to_page=copied['page'], links=False)
                            piece[0].clip_to_rect(clip)
                            target.show_pdf_page(fitz.Rect(0,y,clip.width,y+clip.height),piece,0,clip=clip)
                            piece.close()
                            for link in source_page.get_links():
                                if link['kind'] == fitz.LINK_URI and clip.contains(fitz.Rect(link['from'])):
                                    rect=fitz.Rect(link['from']);rect.y0+=y-clip.y0;rect.y1+=y-clip.y0
                                    target.insert_link({'kind':fitz.LINK_URI,'from':rect,'uri':link['uri']})
                            baseline += clip.height+size*.25
                            continue
                        explicit_bullet = bool(re.match(r'^[-•●▪*]\s+', line))
                        bullet = explicit_bullet or unit['bullet']
                        value = re.sub(r'^[-•●▪*]\s+', '', line) if explicit_bullet else line
                        words = value.split(); wrapped = []; current = ''
                        for word in words:
                            candidate = (current+' '+word).strip()
                            if font.text_length(word, fontsize=size) > right-x:
                                raise ValueError('A word is too wide for the original layout. Shorten it before exporting.')
                            if current and font.text_length(candidate, fontsize=size) > right-x:
                                wrapped.append(current); current = word
                            else: current = candidate
                        if current: wrapped.append(current)
                        if bullet:
                            # Reuse the neighboring point's actual marker, including its
                            # geometry, fill and alignment rather than drawing a new dot.
                            marker = fitz.Rect(max(0,x-16),style['bbox'][1]-.25,x-.5,style['bbox'][3]+.25)
                            if unit['bullet'] and marker.width > 0:
                                piece=fitz.open();piece.insert_pdf(source,from_page=number,to_page=number,links=False)
                                piece[0].clip_to_rect(marker)
                                shift=baseline-style['origin'][1]
                                target.show_pdf_page(fitz.Rect(marker.x0,marker.y0+shift,marker.x1,marker.y1+shift),piece,0,clip=marker)
                                piece.close()
                            else:
                                target.draw_circle((x-7,baseline-size*.3),size*.09,color=None,fill=color)

                        for row in wrapped:
                            target.insert_text((x,baseline),row,fontname=resource_name,fontsize=size,color=color)
                            baseline += size*1.25
                    destination = max(destination, baseline-size*1.25-size*font.descender+2)
                cursor = bottom
            # Leave the original bottom margin available for added text.
            content_bottom = max(u['rect'][3] for u in info['segments'] if u['page']==number)+3
            end = max(cursor, content_bottom)
            if end > cursor: bands.append((cursor,end,destination)); destination += end-cursor
            required_height = max(page.rect.height, destination+12)
            if page.rect.height / required_height < .85:
                raise ValueError('These edits exceed the available page space. Shorten the text to keep the original design readable.')
            heights[number] = required_height
            for top,bottom,dest in bands:
                clip = fitz.Rect(0,top,page.rect.width,bottom)
                piece=fitz.open();piece.insert_pdf(source,from_page=number,to_page=number,links=False)
                piece[0].clip_to_rect(clip)
                target.show_pdf_page(fitz.Rect(0,dest,page.rect.width,dest+bottom-top),piece,0,clip=clip)
                piece.close()
            for link in page.get_links():
                if link['kind'] != fitz.LINK_URI: continue
                rect=fitz.Rect(link['from']);center=(rect.y0+rect.y1)/2
                band=next(((top,bottom,dest) for top,bottom,dest in bands if top<=center<bottom),None)
                if band:
                    shift=band[2]-band[0];rect.y0+=shift;rect.y1+=shift
                    target.insert_link({'kind':fitz.LINK_URI,'from':rect,'uri':link['uri']})
        intermediate = result.tobytes()
        result.close()
        result = fitz.open(stream=intermediate,filetype='pdf')
        normalized = fitz.open()
        for number, rendered in enumerate(result):
            original = source[number]
            if number not in heights:
                normalized.insert_pdf(result,from_page=number,to_page=number)
            else:
                final = normalized.new_page(width=original.rect.width,height=original.rect.height)
                content_rect = fitz.Rect(0,0,original.rect.width,heights[number])
                final.show_pdf_page(final.rect,result,number,clip=content_rect)
                scale = min(final.rect.width/content_rect.width,final.rect.height/content_rect.height)
                offset_x = (final.rect.width-content_rect.width*scale)/2
                offset_y = (final.rect.height-content_rect.height*scale)/2
                for link in rendered.get_links():
                    if link['kind'] == fitz.LINK_URI:
                        rect=fitz.Rect(link['from'])*fitz.Matrix(scale,scale)
                        rect += (offset_x,offset_y,offset_x,offset_y)
                        final.insert_link({'kind':fitz.LINK_URI,'from':rect,'uri':link['uri']})
        normalized.set_metadata(source.metadata)
        output=normalized.tobytes(garbage=4,deflate=True);normalized.close();result.close();return output


def main():
    request=json.load(sys.stdin);raw=base64.b64decode(request['pdf'],validate=True)
    with fitz.open(stream=raw,filetype='pdf') as doc:
        if doc.needs_pass:raise ValueError('Password-protected PDFs are not supported.')
        info=inspect_pdf(doc)
        if request.get('action') == 'edit':
            print(json.dumps({'pdf':base64.b64encode(edit_pdf(raw, request['text'])).decode()}));return
        if request.get('action') in ('export','preview'):
            pdf=export_pdf(raw,doc,info,request.get('orders',[]))
            if request.get('action')=='preview':
                with fitz.open(stream=pdf,filetype='pdf') as rendered:
                    pages=[{'image':base64.b64encode(p.get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False).tobytes('png')).decode(), 'originalImage':base64.b64encode(doc[i].get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False).tobytes('png')).decode()} for i,p in enumerate(rendered)]
                print(json.dumps({'pages':pages}))
            else:print(json.dumps({'pdf':base64.b64encode(pdf).decode()}))
        else:print(json.dumps(info))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'error':str(error)}));sys.exit(1)
