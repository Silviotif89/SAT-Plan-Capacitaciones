/* Generación local de planes mensuales editables. No envía información fuera de Supabase. */
(() => {
  'use strict'
  const MONTH = 'NOVIEMBRE 2026'
  const xml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
  const textBytes = value => new TextEncoder().encode(value)
  const safeName = value => String(value || 'DELEGACION').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase()
  const fileName = (extension, delegation) => `PLAN_MENSUAL_NOVIEMBRE_2026_${safeName(delegation)}.${extension}`
  const dateLabel = value => {
    if (!value) return 'Sin fecha registrada'
    const [year, month, day] = String(value).split('-').map(Number)
    if (!year || !month || !day) return String(value)
    return new Intl.DateTimeFormat('es-NI', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day))
  }
  const timeRange = item => [item.startTime, item.endTime].filter(Boolean).join(' - ')
  const delegationTitle = delegation => ['RACCN', 'RACCS'].includes(String(delegation).toUpperCase()) ? 'DELEGACIÓN REGIONAL DE' : 'DELEGACIÓN DEPARTAMENTAL DE'
  const activities = plan => [...(plan.activities || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.startTime || '').localeCompare(String(b.startTime || '')))
  const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); table[n] = c >>> 0 } return table })()
  const crc32 = bytes => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const zip = files => {
    const entries = files.map(({ name, content }) => ({ name, nameBytes: textBytes(name), bytes: typeof content === 'string' ? textBytes(content) : content }))
    let offset = 0; const locals = []; const central = []
    const part = (length, write) => { const out = new Uint8Array(length); const view = new DataView(out.buffer); write(view, out); return out }
    entries.forEach(entry => {
      const crc = crc32(entry.bytes)
      const local = part(30 + entry.nameBytes.length + entry.bytes.length, (view, out) => { view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(8, 0, true); view.setUint32(14, crc, true); view.setUint32(18, entry.bytes.length, true); view.setUint32(22, entry.bytes.length, true); view.setUint16(26, entry.nameBytes.length, true); out.set(entry.nameBytes, 30); out.set(entry.bytes, 30 + entry.nameBytes.length) })
      const record = part(46 + entry.nameBytes.length, (view, out) => { view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint32(16, crc, true); view.setUint32(20, entry.bytes.length, true); view.setUint32(24, entry.bytes.length, true); view.setUint16(28, entry.nameBytes.length, true); view.setUint32(42, offset, true); out.set(entry.nameBytes, 46) })
      locals.push(local); central.push(record); offset += local.length
    })
    const centralSize = central.reduce((sum, value) => sum + value.length, 0)
    const end = part(22, view => { view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true) })
    const all = [...locals, ...central, end]; const total = all.reduce((sum, value) => sum + value.length, 0); const output = new Uint8Array(total); let cursor = 0; all.forEach(value => { output.set(value, cursor); cursor += value.length }); return output
  }
  const download = (bytes, type, name) => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([bytes], { type })); link.download = name; document.body.append(link); link.click(); setTimeout(() => { URL.revokeObjectURL(link.href); link.remove() }, 1000) }
  const field = (label, value) => value === undefined || value === null || String(value).trim() === '' ? '' : `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${xml(label)}: </w:t></w:r><w:r><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`
  const docx = async plan => {
    let logoBytes = null
    try { const response = await fetch('assets/intur-header.jpg'); if (!response.ok) throw new Error('Recurso institucional no disponible'); logoBytes = new Uint8Array(await response.arrayBuffer()) } catch (_) { /* La descarga mantiene el formato aun si el recurso no está disponible. */ }
    const rows = activities(plan); let previousDate = ''
    const content = rows.map((item, index) => {
      const dateHeading = item.date !== previousDate ? `<w:p><w:pPr><w:spacing w:before="220" w:after="120"/><w:rPr><w:b/><w:u w:val="single"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:u w:val="single"/></w:rPr><w:t>${xml(dateLabel(item.date).toUpperCase())}</w:t></w:r></w:p>` : ''
      previousDate = item.date
      const observation = [item.additionalDates, item.observations].filter(value => String(value || '').trim()).join('. ')
      return `${dateHeading}<w:p><w:pPr><w:keepNext/><w:spacing w:before="100" w:after="100"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${index + 1}. ${xml(item.topic || 'Capacitación sin tema')}</w:t></w:r></w:p>${plan.complete ? field('Departamento o región', item.delegation || plan.delegation) : ''}${field('Municipio', item.municipality)}${field('Hora', timeRange(item))}${field('Lugar', item.location)}${field('Institución que imparte', item.trainingProvider)}${item.ddtFacilitator ? field('Facilitador/a INTUR CENTRAL', item.ddtFacilitator) : ''}${field('Participan', item.participatingInstitutions)}${field('Proyección de participantes', item.projectedParticipants)}${field('Responsable', item.responsible)}${field('Observación', observation)}`
    }).join('') || '<w:p><w:r><w:t>No se registraron capacitaciones para este plan.</w:t></w:r></w:p>'
    const logo = logoBytes ? '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="140"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="5486400" cy="925000"/><wp:docPr id="1" name="Encabezado institucional"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="intur-header.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="925000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' : ''
    const unitHeading = plan.complete ? 'DIRECCIÓN DE DESARROLLO TURÍSTICO' : `${delegationTitle(plan.delegation)} ${String(plan.delegation).toUpperCase()}`
    const departmentHeading = plan.complete ? 'DEPARTAMENTO DE ACOMPAÑAMIENTO TÉCNICO' : ''
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${logo}<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="100"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t>INSTITUTO NICARAGÜENSE DE TURISMO</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="100"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${xml(unitHeading)}</w:t></w:r></w:p>${departmentHeading ? `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="100"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${xml(departmentHeading)}</w:t></w:r></w:p>` : ''}<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="360"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>PLAN MENSUAL DE CAPACITACIONES ${MONTH}</w:t></w:r></w:p>${content}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
    return zip([
      { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${logoBytes ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
      { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Plan mensual de capacitaciones ${MONTH}</dc:title><dc:creator>INTUR</dc:creator></cp:coreProperties>` },
      { name: 'word/document.xml', content: documentXml }, { name: 'word/_rels/document.xml.rels', content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${logoBytes ? '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/intur-header.jpg"/>' : ''}</Relationships>` }, ...(logoBytes ? [{ name: 'word/media/intur-header.jpg', content: logoBytes }] : [])
    ])
  }
  const templateParagraph = (text, { center = false, bold = false, underline = false, keepNext = false, before = 0, after = 0 } = {}) => `<w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}<w:keepLines/><w:spacing w:before="${before}" w:after="${after}" w:line="240" w:lineRule="auto"/>${center ? '<w:jc w:val="center"/>' : ''}</w:pPr><w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="22"/>${underline ? '<w:u w:val="single"/>' : ''}</w:rPr><w:t>${xml(text)}</w:t></w:r></w:p>`
  const templateField = (label, value, keepNext = true) => value === undefined || value === null || String(value).trim() === '' ? '' : `<w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}<w:keepLines/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>${xml(label)}:</w:t></w:r><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve"> ${xml(value)}</w:t></w:r></w:p>`
  const templateBlank = () => '<w:p><w:pPr><w:keepLines/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>'
  const docxFromTemplate = async plan => {
    if (!window.PizZip) throw new Error('No se pudo cargar la plantilla institucional de Word.')
    const response = await fetch('assets/plantilla-sat-mensual.docx')
    if (!response.ok) throw new Error('No se encontró la plantilla institucional de Word.')
    const zip = new window.PizZip(await response.arrayBuffer())
    const original = zip.file('word/document.xml').asText()
    const bodyStart = original.indexOf('<w:body>')
    const bodyEnd = original.lastIndexOf('</w:body>')
    if (bodyStart < 0 || bodyEnd < 0) throw new Error('La plantilla institucional no contiene un cuerpo editable.')
    const existingBody = original.slice(bodyStart + '<w:body>'.length, bodyEnd)
    const sectionStart = existingBody.lastIndexOf('<w:sectPr')
    if (sectionStart < 0) throw new Error('La plantilla institucional no contiene su configuración de página.')
    const section = existingBody.slice(sectionStart)
    const rows = activities(plan)
    let previousDate = ''
    const content = rows.map((item, index) => {
      const date = String(item.date || '')
      const dateHeading = date !== previousDate ? templateParagraph(dateLabel(date), { bold: true, underline: true, keepNext: true, before: 60, after: 40 }) : ''
      previousDate = date
      const observation = [item.additionalDates, item.observations].filter(value => String(value || '').trim()).join('. ')
      return `${dateHeading}${templateParagraph(`${index + 1}. ${item.topic || 'Capacitación sin tema'}`, { bold: true, keepNext: true, before: dateHeading ? 0 : 60, after: 40 })}${plan.complete ? templateField('Departamento o región', item.delegation || plan.delegation) : ''}${templateField('Municipio', item.municipality)}${templateField('Hora', timeRange(item))}${templateField('Lugar', item.location)}${templateField('Institución que imparte', item.trainingProvider)}${templateField('Facilitador/a INTUR CENTRAL', item.ddtFacilitator)}${templateField('Participan', item.participatingInstitutions)}${templateField('Proyección de participantes', item.projectedParticipants)}${templateField('Responsable', item.responsible)}${templateField('Observación', observation, false)}${templateBlank()}`
    }).join('') || templateParagraph('No se registraron capacitaciones para este plan.', { before: 60 })
    const unitHeading = plan.complete ? 'DIRECCIÓN DE DESARROLLO TURÍSTICO' : `${delegationTitle(plan.delegation)} ${String(plan.delegation || '').toUpperCase()}`
    const replacementBody = `${templateParagraph('INSTITUTO NICARAGÜENSE DE TURISMO', { center: true, bold: true })}${templateParagraph(unitHeading, { center: true, bold: true })}${templateParagraph(`PLAN MENSUAL DE CAPACITACIONES ${MONTH}`, { center: true, bold: true, underline: true })}${content}${section}`
    zip.file('word/document.xml', `${original.slice(0, bodyStart + '<w:body>'.length)}${replacementBody}</w:body>${original.slice(bodyEnd + '</w:body>'.length)}`)
    return zip.generate({ type: 'uint8array', compression: 'DEFLATE' })
  }
  const col = index => { let out = ''; for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) out = String.fromCharCode(65 + ((value - 1) % 26)) + out; return out }
  const cell = (ref, value, style = 0, number = false) => number ? `<c r="${ref}" s="${style}"><v>${Number(value) || 0}</v></c>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value ?? '')}</t></is></c>`
  const xlsx = plan => {
    const headers = ['Nº', 'Departamento o región', 'Municipio', 'Nombre de la capacitación', 'Fecha', 'Hora', 'Duración', 'Lugar', 'Institución que imparte', 'Grupo meta o participantes', 'Proyección de participantes', 'Hombres', 'Mujeres', 'Observaciones']
    const data = activities(plan); const width = [7,25,19,42,18,16,16,30,27,31,18,12,12,36]
    const rows = [`<row r="1" ht="25" customHeight="1">${cell('A1','INSTITUTO NICARAGÜENSE DE TURISMO',1)}</row>`,`<row r="2" ht="22" customHeight="1">${cell('A2',`${delegationTitle(plan.delegation)} ${String(plan.delegation || '').toUpperCase()}`,1)}</row>`,`<row r="3" ht="24" customHeight="1">${cell('A3',`PLAN MENSUAL DE CAPACITACIONES ${MONTH}`,1)}</row>`,'<row r="4"/>',`<row r="5" ht="38" customHeight="1">${headers.map((h,i)=>cell(`${col(i+1)}5`,h,2)).join('')}</row>`,...data.map((item,rowIndex)=>{const r=rowIndex+6;const values=[rowIndex+1,plan.delegation,item.municipality,item.topic,item.date,timeRange(item),item.additionalDates||'',item.location,item.trainingProvider,item.participatingInstitutions,item.projectedParticipants,item.hombres??'',item.mujeres??'',item.observations||''];return `<row r="${r}" ht="44" customHeight="1">${values.map((value,i)=>cell(`${col(i+1)}${r}`,value,i===0?4:3,i===0||i===10||(i>10&&value!==''))).join('')}</row>`})]
    const endRow=Math.max(6,data.length+5)
    const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${width.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="3"><mergeCell ref="A1:N1"/><mergeCell ref="A2:N2"/><mergeCell ref="A3:N3"/></mergeCells><autoFilter ref="A5:N${endRow}"/><pageMargins left="0.35" right="0.35" top="0.55" bottom="0.55" header="0.2" footer="0.2"/></worksheet>`
    return zip([
      {name:'[Content_Types].xml',content:'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
      {name:'_rels/.rels',content:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',content:'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Plan mensual" sheetId="1" r:id="rId1"/></sheets></workbook>'},
      {name:'xl/_rels/workbook.xml.rels',content:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
      {name:'xl/styles.xml',content:'<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Aptos"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF152D6B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF176FBA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/></border><border><left style="thin"><color rgb="FFD9E2EF"/></left><right style="thin"><color rgb="FFD9E2EF"/></right><top style="thin"><color rgb="FFD9E2EF"/></top><bottom style="thin"><color rgb="FFD9E2EF"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>'},
      {name:'xl/worksheets/sheet1.xml',content:sheet}
    ])
  }
  const excelWorkbook = plan => {
    const workbookLib = window.XLSX
    if (!workbookLib) throw new Error('No se pudo cargar el generador de Excel.')
    const headers = ['Nº', 'Municipio', 'Nombre de la capacitación', 'Fecha', 'Hora', 'Lugar', 'Institución que imparte', 'Grupo meta o participantes', 'Proyección de participantes', 'Hombres', 'Mujeres', 'Responsable', 'Observación']
    const rows = activities(plan).map((item, index) => [index + 1, item.municipality || '', item.topic || '', item.date || '', timeRange(item), item.location || '', item.trainingProvider || '', item.participatingInstitutions || '', item.projectedParticipants ?? '', item.hombres ?? '', item.mujeres ?? '', item.responsible || '', [item.additionalDates, item.observations].filter(value => String(value || '').trim()).join('. ')])
    const sheet = workbookLib.utils.aoa_to_sheet([
      ['INSTITUTO NICARAGÜENSE DE TURISMO'],
      [`${delegationTitle(plan.delegation)} ${String(plan.delegation || '').toUpperCase()}`],
      [`PLAN MENSUAL DE CAPACITACIONES ${MONTH}`],
      [],
      headers,
      ...rows
    ])
    const endRow = Math.max(6, rows.length + 5)
    const titleStyle = { font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 12 }, fill: { fgColor: { rgb: 'FF152D6B' } }, alignment: { horizontal: 'center', vertical: 'center' } }
    const headerStyle = { font: { bold: true, color: { rgb: 'FFFFFFFF' } }, fill: { fgColor: { rgb: 'FF176FBA' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: { top: { style: 'thin', color: { rgb: 'FFD9E2EF' } }, bottom: { style: 'thin', color: { rgb: 'FFD9E2EF' } }, left: { style: 'thin', color: { rgb: 'FFD9E2EF' } }, right: { style: 'thin', color: { rgb: 'FFD9E2EF' } } } }
    const bodyStyle = { alignment: { vertical: 'top', wrapText: true }, border: { top: { style: 'thin', color: { rgb: 'FFD9E2EF' } }, bottom: { style: 'thin', color: { rgb: 'FFD9E2EF' } }, left: { style: 'thin', color: { rgb: 'FFD9E2EF' } }, right: { style: 'thin', color: { rgb: 'FFD9E2EF' } } } }
    for (let column = 0; column < headers.length; column += 1) {
      const cellRef = workbookLib.utils.encode_cell({ r: 4, c: column })
      sheet[cellRef].s = headerStyle
      for (let row = 5; row < endRow; row += 1) {
        const ref = workbookLib.utils.encode_cell({ r: row, c: column })
        if (sheet[ref]) sheet[ref].s = bodyStyle
      }
    }
    for (const row of [0, 1, 2]) sheet[`A${row + 1}`].s = titleStyle
    sheet['!merges'] = ['A1:M1', 'A2:M2', 'A3:M3'].map(workbookLib.utils.decode_range)
    sheet['!cols'] = [7, 19, 42, 18, 16, 30, 27, 31, 18, 12, 12, 24, 42].map(wch => ({ wch }))
    sheet['!rows'] = [{ hpt: 25 }, { hpt: 22 }, { hpt: 24 }, { hpt: 12 }, { hpt: 38 }, ...rows.map(() => ({ hpt: 44 }))]
    sheet['!autofilter'] = { ref: `A5:M${endRow}` }
    sheet['!pageMargins'] = { left: 0.35, right: 0.35, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 }
    const workbook = workbookLib.utils.book_new()
    workbookLib.utils.book_append_sheet(workbook, sheet, 'Plan mensual')
    return workbookLib.write(workbook, { bookType: 'xlsx', type: 'array', compression: true })
  }
  const completePlan = rows => ({ complete: true, delegation: 'COMPLETO', activities: rows.flatMap(row => (row.activities || []).map(item => ({ ...item, delegation: row.delegation }))).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.startTime || '').localeCompare(String(b.startTime || '')) || String(a.delegation || '').localeCompare(String(b.delegation || ''))) })
  window.SATPlanExports={async word(plan){download(await docxFromTemplate(plan),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',fileName('docx',plan.delegation))},async wordComplete(rows){const plan=completePlan(rows);download(await docxFromTemplate(plan),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',fileName('docx','COMPLETO'))},excel(plan){download(excelWorkbook(plan),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',fileName('xlsx',plan.delegation))}}
})()
