(() => {
  'use strict'

  const CONFIG = window.SAT_CONFIG || {}
  const TABLE = 'sat_november_2026_plans'
  const STORAGE_KEY = 'sat-november-2026-online-v1'
  const ADMIN_SESSION_KEY = 'sat-november-admin-session'
  const REGIONS = {
    'Pacífico': ['Chinandega', 'León', 'Managua', 'Masaya', 'Rivas', 'Carazo', 'Granada'],
    'Norte': ['Jinotega', 'Matagalpa', 'Nueva Segovia', 'Estelí', 'Madriz'],
    'Centro y Sureste': ['Boaco', 'Chontales', 'Río San Juan'],
    'Costa Caribe': ['RACCN', 'RACCS']
  }
  const DELEGATIONS = Object.values(REGIONS).flat()
  const PROVIDERS = ['INTUR', 'INATEC', 'MIFIC', 'MINSA', 'SETEC', 'BOMBEROS', 'POLICÍA', 'Delegación Departamental', 'Otra institución']
  const ACTIVITY_TYPES = ['Capacitación', 'Taller', 'Curso', 'Seminario', 'Charla', 'Asistencia técnica', 'Otra']
  const MODALITIES = ['Presencial', 'Virtual', 'Híbrida']
  const configured = Boolean(CONFIG.supabaseUrl && CONFIG.publishableKey)
  const $ = id => document.getElementById(id)
  const clone = value => JSON.parse(JSON.stringify(value))
  const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `sat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = () => new Date().toISOString()
  const formatDateTime = value => value ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Pendiente'
  const blankActivity = () => ({ id: makeId(), activityType: 'Capacitación', topic: '', date: '2026-11-02', additionalDates: '', startTime: '08:00', endTime: '12:00', municipality: '', location: '', modality: 'Presencial', trainingProvider: '', ddtFacilitator: '', participatingInstitutions: '', responsible: '', projectedParticipants: 25, observations: '' })
  const blankPlan = delegation => ({ remoteId: '', editToken: makeId(), region: regionFor(delegation), delegation, registrantName: '', registrantRole: '', registrantEmail: '', registrantPhone: '', status: 'BORRADOR', activities: [], createdAt: now(), updatedAt: now() })

  let store = loadStore()
  let adminRows = []

  function regionFor(delegation) { return Object.keys(REGIONS).find(region => REGIONS[region].includes(delegation)) || 'Pacífico' }
  function loadStore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved && saved.plans) return saved
    } catch (_) { /* Se inicia un borrador limpio. */ }
    return { selectedDelegation: 'Chinandega', plans: {} }
  }
  function persistLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)) }
  function plan() {
    const name = store.selectedDelegation || 'Chinandega'
    if (!store.plans[name]) store.plans[name] = blankPlan(name)
    return store.plans[name]
  }
  function toast(message) {
    const element = $('toast'); element.textContent = message; element.classList.add('show')
    clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 3200)
  }
  function setOptions(select, values, selected) {
    select.replaceChildren(...values.map(value => new Option(value, value)))
    select.value = selected
  }
  function saveLocalAndRender() {
    plan().updatedAt = now(); persistLocal(); renderSummary()
    $('saveMessage').textContent = 'Borrador conservado en este navegador. Usá “Guardar borrador” para registrarlo en línea.'
  }
  function apiHeaders(token, editToken) {
    const headers = { apikey: CONFIG.publishableKey, Authorization: `Bearer ${token || CONFIG.publishableKey}`, 'Content-Type': 'application/json' }
    if (editToken) headers['x-edit-token'] = editToken
    return headers
  }
  async function api(path, options = {}, token = '', editToken = '') {
    const response = await fetch(`${CONFIG.supabaseUrl}${path}`, { ...options, headers: { ...apiHeaders(token, editToken), ...(options.headers || {}) } })
    const text = await response.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch (_) { body = { message: text || `Error ${response.status}` } }
    if (!response.ok) { const error = new Error(body?.message || body?.error_description || `Error ${response.status}`); error.status = response.status; throw error }
    return body
  }
  function connectionBanner() {
    const box = $('connection'); box.classList.add('visible', configured ? 'ok' : 'warning')
    box.textContent = configured ? '● Conexión central activa. Los botones Guardar y Enviar registran la información para la DDT.' : '⚠ Configuración pendiente: el formulario conserva borradores locales, pero todavía no puede reunir información de varias delegaciones. Completá config.js y Supabase antes de publicarlo.'
  }
  function setupSelectors() {
    setOptions($('region'), Object.keys(REGIONS), regionFor(store.selectedDelegation))
    setOptions($('delegation'), REGIONS[$('region').value], store.selectedDelegation)
    $('region').addEventListener('change', () => {
      const first = REGIONS[$('region').value][0]
      store.selectedDelegation = first; setOptions($('delegation'), REGIONS[$('region').value], first); ensureSelectedPlan(); renderPlan()
    })
    $('delegation').addEventListener('change', () => { store.selectedDelegation = $('delegation').value; ensureSelectedPlan(); renderPlan() })
  }
  function ensureSelectedPlan() { plan(); persistLocal() }
  function bindProfile() {
    const map = { registrantName: 'registrantName', registrantRole: 'registrantRole', registrantEmail: 'registrantEmail', registrantPhone: 'registrantPhone' }
    Object.entries(map).forEach(([id, key]) => {
      $(id).value = plan()[key] || ''
      $(id).oninput = event => { plan()[key] = event.target.value; saveLocalAndRender() }
    })
  }
  function renderPlan() {
    const current = plan(); current.region = regionFor(current.delegation)
    $('region').value = current.region
    if (!REGIONS[current.region].includes($('delegation').value)) setOptions($('delegation'), REGIONS[current.region], current.delegation)
    $('delegation').value = current.delegation
    bindProfile(); renderActivities(); renderSummary()
  }
  function renderSummary() {
    const current = plan()
    $('activityCount').textContent = current.activities.length
    $('participantCount').textContent = current.activities.reduce((sum, item) => sum + (Number(item.projectedParticipants) || 0), 0).toLocaleString('es-NI')
    $('delegationMetric').textContent = current.delegation
    $('lastSaved').textContent = formatDateTime(current.updatedAt)
    $('activitiesHeading').textContent = `Capacitaciones de ${current.delegation}`
    $('planStatus').textContent = current.status === 'ENVIADO' ? 'Plan enviado' : 'Borrador'
    $('planStatus').classList.toggle('sent', current.status === 'ENVIADO')
  }
  function label(text, input, help = '', className = '') {
    const wrapper = document.createElement('label'); if (className) wrapper.className = className
    wrapper.append(document.createTextNode(text), input)
    if (help) { const small = document.createElement('span'); small.className = 'field-help'; small.textContent = help; wrapper.append(small) }
    return wrapper
  }
  function inputControl(value, type = 'text') { const input = document.createElement('input'); input.type = type; input.value = value ?? ''; return input }
  function selectControl(values, value) { const select = document.createElement('select'); select.append(new Option('Seleccionar', ''), ...values.map(item => new Option(item, item))); select.value = value || ''; return select }
  function bindActivityControl(control, item, key, type = 'text') {
    control.dataset.field = key
    control.addEventListener('input', () => { item[key] = type === 'number' ? Math.max(0, Number(control.value) || 0) : control.value; saveLocalAndRender() })
    control.addEventListener('change', () => { item[key] = type === 'number' ? Math.max(0, Number(control.value) || 0) : control.value; saveLocalAndRender(); if (key === 'trainingProvider') renderActivities() })
    return control
  }
  function renderActivities() {
    const root = $('activities'); root.replaceChildren(); const current = plan(); $('emptyState').hidden = current.activities.length > 0
    current.activities.forEach((item, index) => {
      const article = document.createElement('article'); article.className = 'activity-card'
      const head = document.createElement('div'); head.className = 'activity-head'
      const title = document.createElement('strong'); title.textContent = `Actividad ${index + 1}`
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar'
      remove.onclick = () => { if (confirm('¿Eliminar esta capacitación del plan?')) { current.activities.splice(index, 1); saveLocalAndRender(); renderActivities() } }
      head.append(title, remove)
      const grid = document.createElement('div'); grid.className = 'activity-grid'
      const activityType = bindActivityControl(selectControl(ACTIVITY_TYPES, item.activityType), item, 'activityType')
      const topic = bindActivityControl(inputControl(item.topic), item, 'topic'); topic.placeholder = 'Ej. Taller de elaboración de cócteles y aperitivos'
      const date = bindActivityControl(inputControl(item.date, 'date'), item, 'date'); date.min = '2026-11-01'; date.max = '2026-11-30'
      const extraDates = bindActivityControl(inputControl(item.additionalDates), item, 'additionalDates'); extraDates.placeholder = 'Ej. 03 y 04 de noviembre de 2026'
      const start = bindActivityControl(inputControl(item.startTime, 'time'), item, 'startTime')
      const end = bindActivityControl(inputControl(item.endTime, 'time'), item, 'endTime')
      const municipality = bindActivityControl(inputControl(item.municipality), item, 'municipality'); municipality.placeholder = 'Ej. Jinotepe'
      const location = bindActivityControl(inputControl(item.location), item, 'location'); location.placeholder = 'Nombre exacto del local o dirección'
      const modality = bindActivityControl(selectControl(MODALITIES, item.modality), item, 'modality')
      const provider = bindActivityControl(selectControl(PROVIDERS, item.trainingProvider), item, 'trainingProvider')
      const participants = bindActivityControl(inputControl(item.participatingInstitutions), item, 'participatingInstitutions'); participants.placeholder = 'Ej. Delegación INTUR Carazo e INATEC'
      const responsible = bindActivityControl(inputControl(item.responsible), item, 'responsible'); responsible.placeholder = 'Ej. INATEC'
      const projection = bindActivityControl(inputControl(item.projectedParticipants, 'number'), item, 'projectedParticipants', 'number'); projection.min = '0'
      const observations = document.createElement('textarea'); observations.value = item.observations || ''; observations.placeholder = 'Cambios previstos, coordinación pendiente u otra información relevante.'; bindActivityControl(observations, item, 'observations')
      grid.append(
        label('Tipo de actividad', activityType), label('Tema de capacitación', topic, '', 'wide'), label('Fecha principal', date),
        label('Fechas adicionales', extraDates, 'Solo si la misma capacitación se realizará durante varios días.', 'wide'), label('Hora de inicio', start), label('Hora de finalización', end),
        label('Municipio', municipality), label('Lugar', location, '', 'wide'), label('Modalidad', modality),
        label('Institución que imparte', provider), label('Participan', participants, 'Instituciones o actores que acompañan la actividad.', 'wide'), label('Responsable', responsible), label('Proyección de participantes', projection)
      )
      if (item.trainingProvider === 'INTUR') {
        const facilitator = bindActivityControl(inputControl(item.ddtFacilitator), item, 'ddtFacilitator'); facilitator.placeholder = 'Nombre de la persona facilitadora de INTUR'
        grid.append(label('Facilitador/a INTUR', facilitator, '', 'wide'))
      }
      grid.append(label('Observaciones', observations, '', 'full'))
      const actions = document.createElement('div'); actions.className = 'card-save'
      const save = document.createElement('button'); save.type = 'button'; save.className = 'button secondary'; save.textContent = 'Guardar actividad'; save.onclick = () => savePlan('BORRADOR')
      actions.append(save); article.append(head, grid, actions); root.append(article)
    })
  }
  function addActivity() { plan().activities.push(blankActivity()); saveLocalAndRender(); renderActivities(); document.querySelector('.activity-card:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  function validatePlan(finalSubmission = false) {
    const current = plan(); const issues = []
    if (!current.registrantName.trim()) issues.push('nombre de quien registra')
    if (!current.registrantRole.trim()) issues.push('cargo')
    if (!/^\S+@\S+\.\S+$/.test(current.registrantEmail)) issues.push('correo válido')
    if (!current.registrantPhone.trim()) issues.push('teléfono')
    if (!current.activities.length) issues.push('al menos una capacitación')
    current.activities.forEach((item, index) => {
      const required = ['activityType', 'topic', 'date', 'startTime', 'endTime', 'municipality', 'location', 'modality', 'trainingProvider', 'participatingInstitutions', 'responsible']
      const facilitator = String(item.ddtFacilitator || '').trim()
      if (required.some(key => !String(item[key] || '').trim()) || !String(item.date || '').startsWith('2026-11-') || Number(item.projectedParticipants) <= 0 || (item.trainingProvider === 'INTUR' && !facilitator)) issues.push(`datos completos de la actividad ${index + 1}`)
    })
    if (finalSubmission && !$('confirmed').checked) issues.push('confirmación final')
    return [...new Set(issues)]
  }
  function remotePayload(current, status) {
    return { region: current.region, delegation: current.delegation, registrant_name: current.registrantName.trim(), registrant_role: current.registrantRole.trim(), registrant_email: current.registrantEmail.trim(), registrant_phone: current.registrantPhone.trim(), activities: clone(current.activities), status, edit_token: current.editToken, updated_at: now() }
  }
  async function savePlan(status) {
    const finalSubmission = status === 'ENVIADO'; const issues = validatePlan(finalSubmission)
    if (issues.length) { toast(`Revisá: ${issues.join(', ')}.`); return }
    if (!configured) { persistLocal(); toast('Borrador local guardado. Falta conectar Supabase para registrar la información en línea.'); return }
    const current = plan(); const payload = remotePayload(current, status)
    try {
      let rows
      if (current.remoteId) rows = await api(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(current.remoteId)}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) }, '', current.editToken)
      else rows = await api(`/rest/v1/${TABLE}?select=*`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...payload, created_at: now() }) }, '', current.editToken)
      if (!rows?.length) throw new Error('No se confirmó el guardado. Verificá que el navegador conserve el acceso de edición.')
      current.remoteId = rows[0].id; current.status = status; current.updatedAt = rows[0].updated_at || now(); persistLocal(); renderSummary()
      $('saveMessage').textContent = status === 'ENVIADO' ? 'Plan enviado correctamente a la DDT.' : 'Borrador guardado en línea.'
      toast(status === 'ENVIADO' ? 'Plan enviado correctamente.' : 'Borrador guardado en línea.')
    } catch (error) {
      const message = error.status === 409 ? 'Esta delegación ya tiene un plan registrado desde otro navegador. Contactá a la DDT para recuperar el acceso.' : `No se pudo guardar: ${error.message}`
      $('saveMessage').textContent = message; toast(message)
    }
  }
  async function adminLogin(event) {
    event.preventDefault(); $('adminError').textContent = ''
    if (!configured) { $('adminError').textContent = 'Primero debe configurarse la conexión con Supabase.'; return }
    if ($('adminUsername').value.trim().toUpperCase() !== String(CONFIG.adminUsername || '').toUpperCase()) { $('adminError').textContent = 'Usuario o contraseña incorrectos.'; return }
    try {
      const session = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: CONFIG.adminEmail, password: $('adminPassword').value }) })
      sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ accessToken: session.access_token, expiresAt: Date.now() + (session.expires_in * 1000) }))
      $('adminPassword').value = ''; $('adminDialog').close(); await showAdmin(session.access_token)
    } catch (_) { $('adminError').textContent = 'Usuario o contraseña incorrectos.' }
  }
  function getAdminSession() { try { const value = JSON.parse(sessionStorage.getItem(ADMIN_SESSION_KEY) || 'null'); return value && value.expiresAt > Date.now() ? value : null } catch (_) { return null } }
  async function showAdmin(token) {
    $('delegateView').hidden = true; $('adminView').hidden = false
    try { adminRows = await api(`/rest/v1/${TABLE}?select=*&order=updated_at.desc`, {}, token); renderAdmin() }
    catch (error) { toast(`No se pudo abrir el informe: ${error.message}`); adminRows = []; renderAdmin() }
  }
  function text(tag, value, className = '') { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node }
  function renderAdmin() {
    const delegationFilter = $('adminDelegationFilter').value, statusFilter = $('adminStatusFilter').value, query = $('adminSearch').value.trim().toLocaleLowerCase('es')
    const filtered = adminRows.filter(row => (!delegationFilter || row.delegation === delegationFilter) && (!statusFilter || row.status === statusFilter) && (!query || JSON.stringify(row).toLocaleLowerCase('es').includes(query)))
    const totalActivities = adminRows.reduce((sum, row) => sum + (row.activities?.length || 0), 0)
    const totalParticipants = adminRows.reduce((sum, row) => sum + (row.activities || []).reduce((subtotal, item) => subtotal + (Number(item.projectedParticipants) || 0), 0), 0)
    $('adminDelegations').textContent = `${new Set(adminRows.map(row => row.delegation)).size} / 17`; $('adminActivities').textContent = totalActivities; $('adminParticipants').textContent = totalParticipants.toLocaleString('es-NI'); $('adminSubmitted').textContent = adminRows.filter(row => row.status === 'ENVIADO').length
    const root = $('adminList'); root.replaceChildren()
    if (!filtered.length) { root.append(text('div', 'No hay registros para los filtros seleccionados.', 'admin-empty')); return }
    filtered.forEach(row => {
      const details = document.createElement('details'); details.className = 'admin-card'
      const summary = document.createElement('summary'); const count = row.activities?.length || 0; const projected = (row.activities || []).reduce((sum, item) => sum + (Number(item.projectedParticipants) || 0), 0)
      const identity = document.createElement('div'); identity.append(text('strong', row.delegation), text('small', row.region))
      const contact = document.createElement('div'); contact.append(text('strong', row.registrant_name), text('small', row.registrant_role || 'Cargo no indicado'))
      const totals = document.createElement('div'); totals.append(text('strong', `${count} actividades`), text('small', `${projected} participantes`))
      const state = text('span', row.status === 'ENVIADO' ? 'Enviado' : 'Borrador', `admin-state${row.status === 'ENVIADO' ? ' sent' : ''}`)
      summary.append(identity, contact, totals, state)
      const body = document.createElement('div'); body.className = 'admin-detail'
      const contactGrid = document.createElement('div'); contactGrid.className = 'admin-contact'
      ;[['Correo', row.registrant_email], ['Teléfono', row.registrant_phone], ['Última actualización', formatDateTime(row.updated_at)], ['Estado', row.status]].forEach(([name, value]) => { const cell = document.createElement('div'); cell.append(text('small', name), text('b', value || '—')); contactGrid.append(cell) })
      body.append(contactGrid)
      ;(row.activities || []).forEach(item => { const itemRow = document.createElement('div'); itemRow.className = 'admin-activity'; itemRow.append(text('span', item.date || 'Sin fecha'), text('strong', item.topic || 'Sin tema'), text('small', `${item.projectedParticipants || 0} participantes`)); body.append(itemRow) })
      details.append(summary, body); root.append(details)
    })
  }
  function bindEvents() {
    $('addActivity').onclick = addActivity; $('addFirst').onclick = addActivity
    $('saveDraft').onclick = () => savePlan('BORRADOR'); $('submitPlan').onclick = () => savePlan('ENVIADO')
    $('adminAccess').onclick = async () => { const session = getAdminSession(); if (session) await showAdmin(session.accessToken); else $('adminDialog').showModal() }
    $('adminLoginForm').onsubmit = adminLogin
    $('adminLogout').onclick = () => { sessionStorage.removeItem(ADMIN_SESSION_KEY); $('adminView').hidden = true; $('delegateView').hidden = false; toast('Sesión administrativa cerrada.') }
    setOptions($('adminDelegationFilter'), ['Todas', ...DELEGATIONS], 'Todas'); $('adminDelegationFilter').options[0].value = ''
    $('adminDelegationFilter').onchange = renderAdmin; $('adminStatusFilter').onchange = renderAdmin; $('adminSearch').oninput = renderAdmin
    $('adminRefresh').onclick = async () => { const session = getAdminSession(); if (!session) return; await showAdmin(session.accessToken); toast('Informe actualizado.') }
  }
  connectionBanner(); setupSelectors(); bindEvents(); ensureSelectedPlan(); renderPlan()
})()
