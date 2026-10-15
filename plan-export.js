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
  const ddtDateLabel = value => {
    const [year, month, day] = String(value || '').split('-').map(Number)
    if (!year || !month || !day) return 'Fecha pendiente de confirmar'
    const date = new Date(year, month - 1, day)
    const weekday = new Intl.DateTimeFormat('es-NI', { weekday: 'long' }).format(date)
    const monthName = new Intl.DateTimeFormat('es-NI', { month: 'long' }).format(date)
    return `${weekday[0].toLocaleUpperCase('es-NI')}${weekday.slice(1)} ${day} de ${monthName} de ${year}`
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
  const decodeXmlText = value => String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const paragraphText = paragraph => [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => decodeXmlText(match[1])).join('')
  const replaceParagraphText = (paragraph, value) => {
    let index = 0
    return paragraph.replace(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g, (_, open, _current, close) => `${open}${index++ === 0 ? xml(value) : ''}${close}`)
  }
  const replaceFieldValue = (paragraph, value, requestedLabel, labelOverride = '') => {
    const nodes = [...paragraph.matchAll(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g)]
    if (nodes.length < 2) throw new Error(`La plantilla no tiene un campo editable para ${requestedLabel}.`)
    const firstText = decodeXmlText(nodes[0][2])
    const colon = firstText.indexOf(':')
    if (colon < 0) throw new Error(`No se pudo reconocer la etiqueta ${requestedLabel} en la plantilla.`)
    const originalLabel = labelOverride || firstText.slice(0, colon + 1)
    const labelSuffix = firstText.slice(colon + 1)
    const valueIndex = nodes.findIndex((node, index) => index > 0 && decodeXmlText(node[2]).trim())
    if (valueIndex < 1) throw new Error(`La plantilla no tiene un valor de muestra para ${requestedLabel}.`)
    const originalValue = decodeXmlText(nodes[valueIndex][2])
    const hasSeparateSpace = nodes.slice(1, valueIndex).some(node => !decodeXmlText(node[2]).trim())
    const leadingValueSpace = /^\s+/.exec(originalValue)?.[0] || ''
    const insertSeparator = !labelSuffix && !hasSeparateSpace && !leadingValueSpace
    const replacements = new Map([[0, `${originalLabel}${labelSuffix || (insertSeparator ? ' ' : '')}`], [valueIndex, `${leadingValueSpace}${value}`]])
    let output = paragraph
    // Replace from right to left so earlier byte offsets remain valid.
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index]
      const replacement = replacements.has(index) ? replacements.get(index) : decodeXmlText(node[2]).trim() ? '' : node[2]
      output = output.slice(0, node.index) + `${node[1]}${xml(replacement)}${node[3]}` + output.slice(node.index + node[0].length)
    }
    return output
  }
  const withoutRenderedBreaks = paragraph => paragraph.replace(/<w:lastRenderedPageBreak\b[^>]*\/?\s*>/g, '')
  const ddtWord = async activitiesForExport => {
    if (!window.PizZip) throw new Error('No se pudo cargar el lector de la plantilla institucional de Word.')
    if (!Array.isArray(activitiesForExport) || !activitiesForExport.length) throw new Error('No hay capacitaciones asignadas a INTUR CENTRAL para noviembre 2026.')
    const response = await fetch('assets/plan-ddt-template.docx')
    if (!response.ok) throw new Error('No se encontró la plantilla oficial del Plan DDT.')
    const zipFile = new window.PizZip(await response.arrayBuffer())
    const documentPath = 'word/document.xml'
    const original = zipFile.file(documentPath)?.asText()
    const bodyMatch = original && /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/.exec(original)
    if (!bodyMatch) throw new Error('La plantilla oficial no contiene un cuerpo de documento editable.')
    const usedParagraphIds = new Set([...original.matchAll(/\bw14:paraId="([A-Fa-f0-9]{8})"/g)].map(match => match[1].toUpperCase()))
    const nextParagraphId = () => {
      let id
      do { id = Math.random().toString(16).slice(2, 10).padEnd(8, '0').toUpperCase() } while (usedParagraphIds.has(id))
      usedParagraphIds.add(id); return id
    }
    const cloneParagraph = paragraph => withoutRenderedBreaks(paragraph).replace(/\bw14:paraId="[^"]+"/g, () => `w14:paraId="${nextParagraphId()}"`)
    const body = bodyMatch[1]
    const paragraphs = [...body.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(match => match[0])
    const nonempty = paragraphs.map((paragraph, index) => ({ paragraph, index, content: paragraphText(paragraph).trim() })).filter(item => item.content)
    if (nonempty.length < 10) throw new Error('No se reconoció la estructura de la plantilla DDT.')
    const titleTemplates = nonempty.slice(0, 3).map(item => withoutRenderedBreaks(item.paragraph))
    const dateTemplate = nonempty.find(item => /^\p{L}+\s+\d{1,2}\s+de\s+septiembre\s+de\s+2026$/iu.test(item.content))?.paragraph
    const activityTitleTemplate = nonempty.find(item => /^\d+\.\s+/.test(item.content))?.paragraph
    const findField = label => nonempty.find(item => item.content.startsWith(`${label}:`))?.paragraph
    const templates = {
      date: dateTemplate,
      title: activityTitleTemplate,
      department: findField('Departamento'),
      time: findField('Hora'),
      place: findField('Lugar'),
      participants: findField('Participan'),
      projection: findField('Proyección de Participantes'),
      responsible: findField('Responsable'),
      departure: findField('Salida'),
    }
    if (Object.entries(templates).some(([key, value]) => key !== 'departure' && !value)) throw new Error('Faltan párrafos de formato requeridos en la plantilla DDT.')
    const firstActivityEnd = paragraphs.findIndex(paragraph => paragraph === templates.responsible)
    const blankTemplate = paragraphs.slice(firstActivityEnd + 1).find(paragraph => !paragraphText(paragraph).trim()) || '<w:p/>'
    const sectionMatch = /<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>/.exec(body)
    if (!sectionMatch) throw new Error('La plantilla no contiene su configuración original de página.')
    const sorted = [...activitiesForExport].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.startTime || '').localeCompare(String(b.startTime || '')) || String(a.delegation || '').localeCompare(String(b.delegation || ''), 'es', { sensitivity: 'base' }))
    const byDate = new Map()
    sorted.forEach(activity => {
      const date = String(activity.date || '')
      if (!byDate.has(date)) byDate.set(date, [])
      byDate.get(date).push(activity)
    })
    const title = titleTemplates.map((paragraph, index) => index === 2 ? replaceParagraphText(paragraph, paragraphText(paragraph).replace(/SEPTIEMBRE/i, 'NOVIEMBRE')) : paragraph)
    let nextNumber = 0
    const content = [...byDate.entries()].map(([date, dailyActivities]) => {
      const heading = replaceParagraphText(cloneParagraph(templates.date), ddtDateLabel(date))
      const dailyContent = dailyActivities.map(activity => {
        nextNumber += 1
        const number = nextNumber
        const topic = String(activity.topic || '').trim() || 'Pendiente de confirmar'
        const titleParagraph = replaceParagraphText(cloneParagraph(templates.title), `${number}. ${topic}`)
        const department = String(activity.delegation || '').trim() || 'Pendiente de confirmar'
        const municipality = String(activity.municipality || '').trim()
        const location = String(activity.location || '').trim()
        const place = municipality && location && !location.toLocaleLowerCase('es-NI').includes(municipality.toLocaleLowerCase('es-NI')) ? `${municipality} — ${location}` : location || municipality || 'Pendiente de confirmar'
        const scheduledTime = [activity.startTime, activity.endTime].filter(value => String(value || '').trim()).map(timeLabel).join(' – ') || 'Pendiente de confirmar'
        const participants = String(activity.participatingInstitutions || '').trim() || 'Pendiente de confirmar'
        const projected = Number(activity.projectedParticipants)
        const projection = Number.isFinite(projected) && projected > 0 ? `${projected.toLocaleString('es-NI')} personas` : 'Pendiente de confirmar'
        const isInturCentral = String(activity.trainingProvider || '').trim().toUpperCase() === 'INTUR CENTRAL'
        const responsible = String((isInturCentral ? activity.ddtFacilitator : activity.responsible) || '').trim() || 'Pendiente de confirmar'
        const observations = [activity.additionalDates ? `Fechas adicionales: ${String(activity.additionalDates).trim()}` : '', String(activity.observations || '').trim()].filter(Boolean).join(' · ')
        const departureValue = String(activity.departureTime || activity.departure || '').trim()
        return [
          titleParagraph,
          replaceFieldValue(cloneParagraph(templates.department), department, 'Departamento'),
          replaceFieldValue(cloneParagraph(templates.time), scheduledTime, 'Hora'),
          replaceFieldValue(cloneParagraph(templates.place), place, 'Lugar'),
          replaceFieldValue(cloneParagraph(templates.participants), participants, 'Participan'),
          replaceFieldValue(cloneParagraph(templates.projection), projection, 'Proyección de Participantes'),
          replaceFieldValue(cloneParagraph(templates.responsible), responsible, 'Responsable'),
          observations ? replaceFieldValue(cloneParagraph(templates.participants), observations, 'Observaciones', 'Observaciones:') : '',
          departureValue && templates.departure ? replaceParagraphText(cloneParagraph(templates.departure), `Salida: ${timeLabel(departureValue)}`) : '',
          cloneParagraph(blankTemplate),
        ].filter(Boolean).join('')
      }).join('')
      return `${heading}${dailyContent}`
    }).join('')
    const replacementBody = `${title.join('')}${cloneParagraph(blankTemplate)}${content}${sectionMatch[0]}`
    const bodyOpenEnd = bodyMatch[0].indexOf('>') + 1
    const newDocument = `${original.slice(0, bodyMatch.index)}${bodyMatch[0].slice(0, bodyOpenEnd)}${replacementBody}</w:body>${original.slice(bodyMatch.index + bodyMatch[0].length)}`
    zipFile.file(documentPath, newDocument)
    download(zipFile.generate({ type: 'uint8array', compression: 'DEFLATE' }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'PLAN_DDT_NOVIEMBRE_2026.docx')
  }
  const columnLetter = index => String.fromCharCode(65 + index)
  const timeLabel = value => {
    const raw = String(value || '').trim()
    const match = /^(\d{1,2}):(\d{2})$/.exec(raw)
    if (!match) return raw
    const hour = Number(match[1]), minute = match[2]
    if (hour > 23 || Number(minute) > 59) return raw
    return `${String(hour % 12 || 12).padStart(2, '0')}:${minute} ${hour < 12 ? 'a. m.' : 'p. m.'}`
  }
  const scheduleLabel = item => [timeLabel(item.startTime), timeLabel(item.endTime)].filter(Boolean).join(' – ')
  const facilitatorLabel = item => {
    const provider = String(item.trainingProvider || '').trim()
    const normalizedProvider = provider.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    return normalizedProvider === 'INTUR CENTRAL' ? (item.ddtFacilitator || '') : provider
  }
  const dateCell = item => [item.date ? dateLabel(item.date) : '', String(item.additionalDates || '').trim()].filter(Boolean).join('; ')
  const observationCell = item => [
    item.activityType ? `Tipo de actividad: ${item.activityType}` : '',
    item.location ? `Lugar: ${item.location}` : '',
    item.trainingProvider ? `Institución que imparte: ${item.trainingProvider}` : '',
    item.participatingInstitutions ? `Instituciones o actores participantes: ${item.participatingInstitutions}` : '',
    item.responsible ? `Responsable: ${item.responsible}` : '',
    item.observations ? `Observaciones: ${item.observations}` : '',
  ].filter(Boolean).join('; ')
  const verticalMergeRanges = (rows, columnIndex) => {
    const ranges = []; let start = 0
    while (start < rows.length) {
      const value = String(rows[start][columnIndex] || '').trim(); let end = start + 1
      while (value && end < rows.length && String(rows[end][columnIndex] || '').trim() === value) end += 1
      if (value && end - start > 1) {
        ranges.push(`${columnLetter(columnIndex)}${start + 4}:${columnLetter(columnIndex)}${end + 3}`)
        for (let index = start + 1; index < end; index += 1) rows[index][columnIndex] = ''
      }
      start = end
    }
    return ranges
  }
  const templateExcelWorkbook = async plan => {
    if (!window.PizZip) throw new Error('No se pudo cargar el lector de la plantilla Excel.')
    const response = await fetch('assets/plantilla-plan-mensual.xlsx')
    if (!response.ok) throw new Error('No se encontró la plantilla oficial del plan mensual.')
    const zipFile = new window.PizZip(await response.arrayBuffer())
    const sheetPath = 'xl/worksheets/sheet1.xml', workbookPath = 'xl/workbook.xml', stylesPath = 'xl/styles.xml'
    let sheetXml = zipFile.file(sheetPath)?.asText(), workbookXml = zipFile.file(workbookPath)?.asText(), stylesXml = zipFile.file(stylesPath)?.asText()
    if (!sheetXml || !workbookXml || !stylesXml) throw new Error('La plantilla Excel no contiene la hoja y estilos esperados.')
    const sheetDataMatch = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(sheetXml)
    if (!sheetDataMatch) throw new Error('La plantilla Excel no contiene la tabla principal.')
    const eligibleActivities = [...(plan.activities || [])]
      .filter(item => !item.draft && String(item.date || '').startsWith('2026-11-'))
    const chronologicalActivities = [...eligibleActivities]
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.startTime || '').localeCompare(String(b.startTime || '')) || String(a.delegation || '').localeCompare(String(b.delegation || ''), 'es', { sensitivity: 'base' }))
    const generalPlanNumbers = new Map(chronologicalActivities.map((item, index) => [item, index + 1]))
    const orderedActivities = [...eligibleActivities].sort((a, b) => {
        const delegationOrder = plan.complete
          ? String(a.delegation || '').localeCompare(String(b.delegation || ''), 'es', { sensitivity: 'base' })
          : 0
        return delegationOrder || String(a.date || '').localeCompare(String(b.date || '')) || String(a.startTime || '').localeCompare(String(b.startTime || ''))
      })
    const rows = orderedActivities
      .map((item, index) => [
        plan.complete ? generalPlanNumbers.get(item) : index + 1, String(item.delegation || plan.delegation || '').toUpperCase(), item.municipality || '', item.topic || '', scheduleLabel(item), '', '', '', '', '', dateCell(item),
        item.projectedParticipants === '' || item.projectedParticipants == null || !Number.isFinite(Number(item.projectedParticipants)) ? '' : Number(item.projectedParticipants), facilitatorLabel(item), observationCell(item),
      ])
    if (!rows.length) throw new Error('No hay capacitaciones guardadas en Supabase para noviembre de 2026.')
    const sourceRows = sheetDataMatch[1]
    const templateRow = /<row\b[^>]*\br="4"[^>]*>[\s\S]*?<\/row>/.exec(sourceRows)?.[0]
    if (!templateRow) throw new Error('No se pudo encontrar la fila de formato en la plantilla.')
    const rowAttributes = /<row\b([^>]*)>/.exec(templateRow)?.[1] || ''
    const borderCollection = /<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(stylesXml)
    const cellXfsCollection = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)
    if (!borderCollection || !cellXfsCollection) throw new Error('No se pudieron leer los bordes de la plantilla Excel.')
    const borders = borderCollection[1].match(/<border\b[^>]*>[\s\S]*?<\/border>/g) || []
    const cellStyles = cellXfsCollection[1].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) || []
    const gridBorderId = borders.findIndex(border => ['left', 'right', 'top', 'bottom'].every(side => new RegExp(`<${side}\\b[^>]*\\bstyle=`).test(border)))
    if (gridBorderId < 0 || !cellStyles.length) throw new Error('La plantilla no define un borde completo para la tabla.')
    const addedStyles = []
    const ensureGridStyle = styleId => {
      const style = cellStyles[Number(styleId)]
      if (!style) throw new Error('No se encontró el estilo de una columna de la tabla.')
      const borderId = Number(/\bborderId="(\d+)"/.exec(style)?.[1] || 0)
      const currentBorder = borders[borderId] || ''
      if (['left', 'right', 'top', 'bottom'].every(side => new RegExp(`<${side}\\b[^>]*\\bstyle=`).test(currentBorder))) return String(styleId)
      const updatedStyle = style.replace(/<xf\b([^>]*?)(\/?)>/, (_, attributes, selfClosing) => {
        let nextAttributes = attributes.replace(/\bborderId="\d+"/, `borderId="${gridBorderId}"`).replace(/\s+\/$/, '')
        if (!/\bborderId=/.test(nextAttributes)) nextAttributes += ` borderId="${gridBorderId}"`
        if (!/\bapplyBorder=/.test(nextAttributes)) nextAttributes += ' applyBorder="1"'
        return `<xf${nextAttributes}${selfClosing}>`
      })
      const nextId = cellStyles.length + addedStyles.length
      addedStyles.push(updatedStyle)
      return String(nextId)
    }
    const styles = {}
    for (let index = 0; index < 14; index += 1) {
      const col = columnLetter(index)
      const cellMatch = new RegExp(`<c\\b([^>]*\\br="${col}4"[^>]*)\\s*/?>`).exec(templateRow)
      if (!cellMatch) throw new Error(`La plantilla no contiene el estilo de la columna ${col}.`)
      styles[col] = ensureGridStyle(/\bs="(\d+)"/.exec(cellMatch[1])?.[1] || '0')
    }
    const headerRows = [...sourceRows.matchAll(/<row\b[^>]*\br="([123])"[^>]*>[\s\S]*?<\/row>/g)].map(match => match[0])
    if (headerRows.length !== 3) throw new Error('La plantilla no contiene sus tres filas de encabezado.')
    const columnHeadings = headerRows.findIndex(row => /<row\b[^>]*\br="3"/.test(row))
    headerRows[columnHeadings] = headerRows[columnHeadings].replace(/<c\b([^>]*\br="E3"[^>]*)>[\s\S]*?<\/c>/, (_, attributes) => `<c${attributes.replace(/\s+t="[^"]*"/, '')} t="inlineStr"><is><t>Horario</t></is></c>`)
    const merges = ['A1:M1', 'A2:M2', ...verticalMergeRanges(rows, 1)]
    const dataRows = rows.map((values, rowIndex) => {
      const rowNumber = rowIndex + 4
      const cells = values.map((value, index) => {
        const col = columnLetter(index), style = styles[col]
        if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${col}${rowNumber}" s="${style}"><v>${value}</v></c>`
        return value === '' || value == null
          ? `<c r="${col}${rowNumber}" s="${style}"/>`
          : `<c r="${col}${rowNumber}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
      }).join('')
      const attributes = rowAttributes.replace(/\br="4"/, `r="${rowNumber}"`).replace(/\s+hidden="[^"]*"/, '')
      return `<row${attributes}>${cells}</row>`
    })
    const endRow = rows.length + 3
    sheetXml = sheetXml.replace(sheetDataMatch[0], `<sheetData>${headerRows.join('')}${dataRows.join('')}</sheetData>`)
    sheetXml = sheetXml.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/, `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`)
    sheetXml = sheetXml.replace(/(<dimension\b[^>]*\bref=")[^"]+/, `$1A1:N${endRow}`)
    sheetXml = sheetXml.replace(/(<autoFilter\b[^>]*\bref=")[^"]+/, `$1A3:N${endRow}`)
    workbookXml = workbookXml.replace(/(<sheet\b[^>]*\bname=")[^"]+/, '$1PLAN NOVIEMBRE 2026')
    workbookXml = workbookXml.replace(/(<definedName\b[^>]*name="_xlnm\._FilterDatabase"[^>]*>)[\s\S]*?(<\/definedName>)/, (_, open, close) => `${open}'PLAN NOVIEMBRE 2026'!$A$3:$N$${endRow}${close}`)
    if (addedStyles.length) {
      stylesXml = stylesXml.replace(/(<cellXfs\b[^>]*\bcount=")(\d+)(")/, (_, open, count, close) => `${open}${Number(count) + addedStyles.length}${close}`)
      stylesXml = stylesXml.replace('</cellXfs>', `${addedStyles.join('')}</cellXfs>`)
      zipFile.file(stylesPath, stylesXml)
    }
    zipFile.file(sheetPath, sheetXml)
    zipFile.file(workbookPath, workbookXml)
    const appPath = 'docProps/app.xml', appXml = zipFile.file(appPath)?.asText()
    if (appXml) zipFile.file(appPath, appXml.replace(/PLAN (?:SEPTIEMBRE|NOVIEMBRE) 2026/g, 'PLAN NOVIEMBRE 2026'))
    const corePath = 'docProps/core.xml', coreXml = zipFile.file(corePath)?.asText()
    if (coreXml) zipFile.file(corePath, coreXml.replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, '<dc:creator>INTUR</dc:creator>').replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy>INTUR</cp:lastModifiedBy>'))
    return zipFile.generate({ type: 'uint8array', compression: 'DEFLATE' })
  }
  const completePlan = rows => ({ complete: true, delegation: 'COMPLETO', activities: rows.flatMap(row => (row.activities || []).map(item => ({ ...item, delegation: row.delegation }))).sort((a, b) => String(a.delegation || '').localeCompare(String(b.delegation || ''), 'es', { sensitivity: 'base' }) || String(a.date || '').localeCompare(String(b.date || '')) || String(a.startTime || '').localeCompare(String(b.startTime || ''))) })
  window.SATPlanExports={async word(plan){download(await docxFromTemplate(plan),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',fileName('docx',plan.delegation))},async wordComplete(rows){const plan=completePlan(rows);download(await docxFromTemplate(plan),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',fileName('docx','COMPLETO'))},async ddtWord(activities){await ddtWord(activities)},async excel(plan){download(await templateExcelWorkbook(plan),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',fileName('xlsx',plan.delegation))},async excelComplete(rows){const plan=completePlan(rows);download(await templateExcelWorkbook(plan),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',fileName('xlsx','COMPLETO'))}}
})()
