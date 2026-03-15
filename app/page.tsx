'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import styles from './page.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────
interface JiraIssue {
  id: string; key: string
  fields: {
    summary: string
    status: { name: string; statusCategory: { key: string } }
    assignee: { displayName: string; emailAddress: string } | null
    priority: { name: string } | null
    issuelinks: IssueLink[]
    issuetype: { name: string }
    created: string; updated: string
    description?: any
    comment?: { comments: Comment[] }
    parent?: { key: string; fields: { summary: string } }
  }
}
interface IssueLink {
  id: string; type: { name: string }
  outwardIssue?: { key: string; fields: { summary: string; status: { name: string } } }
  inwardIssue?: { key: string; fields: { summary: string; status: { name: string } } }
}
interface Comment { id: string; author: { displayName: string }; body: any; created: string }

// ─── Constants ────────────────────────────────────────────────────────────────
const JIRA_URL = 'https://dgtbigc.atlassian.net/browse/'

const STATUS_ORDER = [
  'S0 - Create Idea', 'S1-Confirm Idea', 'S2 - Validated Idea',
  'S3 - Detail Requirement - PRD', 'S4- Project Planning',
  'S5 - In Development', 'S6 - UAT Execute', 's7 - Project Deliverd', 'OPEN'
]
const STATUS_SHORT: Record<string, string> = {
  'S0 - Create Idea': 'S0 Idea', 'S1-Confirm Idea': 'S1 Confirm',
  'S2 - Validated Idea': 'S2 Validate', 'S3 - Detail Requirement - PRD': 'S3 PRD',
  'S4- Project Planning': 'S4 Plan', 'S5 - In Development': 'S5 Dev',
  'S6 - UAT Execute': 'S6 UAT', 's7 - Project Deliverd': 'S7 Done', 'OPEN': 'Open'
}
const STATUS_COLOR: Record<string, string> = {
  'S0 - Create Idea': '#7070CC', 'S1-Confirm Idea': '#4FDEF7',
  'S2 - Validated Idea': '#4FC87A', 'S3 - Detail Requirement - PRD': '#F7B84F',
  'S4- Project Planning': '#C8C840', 'S5 - In Development': '#4F8EF7',
  'S6 - UAT Execute': '#E070C8', 's7 - Project Deliverd': '#3DD68C', 'OPEN': '#4A5878'
}
const STATUS_BG: Record<string, string> = {
  'S0 - Create Idea': '#1A1A2A', 'S1-Confirm Idea': '#0A2228',
  'S2 - Validated Idea': '#0E2818', 'S3 - Detail Requirement - PRD': '#2A1E0A',
  'S4- Project Planning': '#1A1A0A', 'S5 - In Development': '#1A2744',
  'S6 - UAT Execute': '#2A1A28', 's7 - Project Deliverd': '#0E2A1E', 'OPEN': '#1E2535'
}
const CHILD_STATUS_COLOR: Record<string, string> = {
  'To Do': '#7070CC', 'In Progress': '#4F8EF7', 'In Review': '#9B7EF7',
  'Ready To Test': '#F7B84F', 'Done': '#3DD68C', 'Pending': '#4A5878'
}
const CHILD_STATUS_BG: Record<string, string> = {
  'To Do': '#1A1A2A', 'In Progress': '#1A2744', 'In Review': '#1E1A2A',
  'Ready To Test': '#2A1E0A', 'Done': '#0E2A1E', 'Pending': '#1E2535'
}
const PRI_COLOR: Record<string, string> = { P1: '#F75F5F', P2: '#F7A84F', P3: '#8A9BC4', Medium: '#8A9BC4', Lowest: '#4A5878', Meduim: '#8A9BC4' }
const PRI_BG: Record<string, string> = { P1: '#2A0E0E', P2: '#2A1A0A', P3: '#1E2535', Medium: '#1E2535', Lowest: '#1E2535', Meduim: '#1E2535' }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtDate = (s: string) => { try { return new Date(s).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) } catch { return '' } }
const shortName = (n: string) => (n || '').replace(/^DGT\s+/i, '').split(' ')[0]
const initials = (n: string) => (n || '').replace(/^DGT\s+/i, '').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase()
const linkedFedKeys = (issue: JiraIssue) =>
  (issue.fields.issuelinks || []).flatMap(l => [l.outwardIssue?.key, l.inwardIssue?.key]).filter((k): k is string => !!k && k.startsWith('FED-'))

function childProgress(children: JiraIssue[]) {
  if (!children.length) return null
  const done = children.filter(c => c.fields.status.name === 'Done').length
  const rtt  = children.filter(c => c.fields.status.name === 'Ready To Test').length
  const pct  = Math.round((done + rtt) / children.length * 100)
  return { done, rtt, total: children.length, pct }
}

// ─── Badge component ─────────────────────────────────────────────────────────
function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
      borderRadius: 4, fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap',
      color, background: bg, border: `1px solid ${color}33`
    }}>{label}</span>
  )
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────
function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div>
      <div style={{ height: 4, background: '#242B3D', borderRadius: 2, overflow: 'hidden', width: 56 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width .4s' }} />
      </div>
      <div style={{ fontSize: 9, color: '#4A5878', textAlign: 'right', marginTop: 1, fontFamily: 'var(--mono)' }}>{pct}%</div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [issues, setIssues] = useState<JiraIssue[]>([])
  const [childMap, setChildMap] = useState<Record<string, JiraIssue>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastSync, setLastSync] = useState('')
  const [search, setSearch] = useState('')
  const [activeStatus, setActiveStatus] = useState('all')
  const [view, setView] = useState<'list' | 'kanban'>('list')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<JiraIssue | null>(null)
  const [modalDetail, setModalDetail] = useState<JiraIssue | null>(null)
  const [modalLoading, setModalLoading] = useState(false)

  // ── Fetch FEPMF issues ────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/jira?action=fepmf')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const all: JiraIssue[] = data.issues || []
      setIssues(all)
      setLastSync(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }))
      // Fetch child FED issues
      const fedKeys = [...new Set(all.flatMap(linkedFedKeys))]
      if (fedKeys.length) {
        const batchSize = 30
        const map: Record<string, JiraIssue> = {}
        for (let i = 0; i < fedKeys.length; i += batchSize) {
          const batch = fedKeys.slice(i, i + batchSize)
          const r = await fetch(`/api/jira?action=children&keys=${batch.join(',')}`)
          const d = await r.json()
          ;(d.issues || []).forEach((c: JiraIssue) => { map[c.key] = c })
        }
        setChildMap(map)
      }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Open modal with full issue detail ─────────────────────────────────────
  const openModal = async (issue: JiraIssue) => {
    setModal(issue); setModalDetail(null); setModalLoading(true)
    try {
      const res = await fetch(`/api/jira?action=issue&key=${issue.key}`)
      const data = await res.json()
      setModalDetail(data)
    } catch {}
    setModalLoading(false)
  }

  // ── Filtered issues ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return issues.filter(i => {
      if (activeStatus !== 'all' && i.fields.status.name !== activeStatus) return false
      if (q) {
        const hay = `${i.key} ${i.fields.summary} ${i.fields.assignee?.displayName || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [issues, activeStatus, search])

  // ── Status counts ─────────────────────────────────────────────────────────
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: issues.length }
    issues.forEach(i => { const s = i.fields.status.name; c[s] = (c[s] || 0) + 1 })
    return c
  }, [issues])

  // ── Assignee counts ───────────────────────────────────────────────────────
  const assigneeCounts = useMemo(() => {
    const c: Record<string, number> = {}
    issues.forEach(i => { const a = shortName(i.fields.assignee?.displayName || 'Unassigned'); c[a] = (c[a] || 0) + 1 })
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 7)
  }, [issues])

  const toggle = (key: string) => setExpanded(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 12, color: '#4A5878' }}>
      <div className="spin" style={{ width: 32, height: 32, border: '2px solid #242B3D', borderTopColor: '#4F8EF7', borderRadius: '50%' }} />
      <span style={{ fontSize: 13 }}>กำลังโหลดข้อมูลจาก Jira…</span>
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 8, color: '#F75F5F' }}>
      <div style={{ fontSize: 15, fontWeight: 500 }}>ไม่สามารถดึงข้อมูลได้</div>
      <div style={{ fontSize: 12, color: '#4A5878' }}>{error}</div>
      <button onClick={loadData} style={{ marginTop: 8, background: '#1A2744', border: '1px solid #2D5DB8', color: '#4F8EF7', padding: '7px 16px', borderRadius: 8, fontSize: 13 }}>ลองใหม่</button>
    </div>
  )

  const total = issues.length || 1
  const s5Count = statusCounts['S5 - In Development'] || 0
  const s6Count = statusCounts['S6 - UAT Execute'] || 0
  const s7Count = statusCounts['s7 - Project Deliverd'] || 0
  const childCount = Object.keys(childMap).length

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <header style={{ background: '#161B25', borderBottom: '1px solid #2A3448', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, background: 'linear-gradient(135deg,#4F8EF7,#9B7EF7)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#fff' }}>PM</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>FEPMF Dashboard</div>
            <div style={{ fontSize: 10, color: '#4A5878', fontFamily: 'var(--mono)' }}>Front-End Project Management Framework</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="pulse" style={{ width: 6, height: 6, background: '#3DD68C', borderRadius: '50%' }} />
          {lastSync && <span style={{ fontSize: 11, color: '#4A5878', fontFamily: 'var(--mono)' }}>synced {lastSync}</span>}
          <button onClick={loadData} style={{ background: '#1E2535', border: '1px solid #2A3448', color: '#8A9BC4', padding: '5px 14px', borderRadius: 7, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            ↻ Refresh
          </button>
        </div>
      </header>

      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div style={{ background: '#161B25', borderBottom: '1px solid #2A3448', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#4A5878', fontSize: 13 }}>🔍</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา Issue, key, assignee…"
            style={{ background: '#1E2535', border: '1px solid #2A3448', color: '#E8EDF8', padding: '7px 10px 7px 30px', borderRadius: 8, fontSize: 13, width: '100%', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['all', ...STATUS_ORDER.filter(s => statusCounts[s])].map(s => (
            <button key={s} onClick={() => setActiveStatus(s)}
              style={{
                padding: '4px 11px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid transparent',
                background: activeStatus === s ? STATUS_BG[s] || '#1A2744' : 'transparent',
                color: activeStatus === s ? STATUS_COLOR[s] || '#4F8EF7' : '#8A9BC4',
                borderColor: activeStatus === s ? (STATUS_COLOR[s] || '#2D5DB8') + '66' : 'transparent',
              }}>
              {s === 'all' ? 'All' : STATUS_SHORT[s] || s}
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, opacity: .7, marginLeft: 4 }}>{statusCounts[s] || issues.length}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', background: '#1E2535', border: '1px solid #2A3448', borderRadius: 8, overflow: 'hidden', marginLeft: 'auto' }}>
          {(['list', 'kanban'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '5px 12px', fontSize: 12, border: 'none', background: view === v ? '#242B3D' : 'transparent', color: view === v ? '#E8EDF8' : '#8A9BC4' }}>
              {v === 'list' ? 'List' : 'Kanban'}
            </button>
          ))}
        </div>
      </div>

      <main style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>

        {/* ── Stats row ──────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
          {[
            { label: 'Total Issues', val: issues.length, color: '#4F8EF7', sub: 'FEPMF Board', onClick: () => setActiveStatus('all') },
            { label: 'In Development', val: s5Count, color: '#4FC8F7', sub: `${Math.round(s5Count/total*100)}% of total`, onClick: () => setActiveStatus('S5 - In Development') },
            { label: 'UAT / Testing', val: s6Count, color: '#E070C8', sub: `${Math.round(s6Count/total*100)}% of total`, onClick: () => setActiveStatus('S6 - UAT Execute') },
            { label: 'Delivered', val: s7Count, color: '#3DD68C', sub: `${Math.round(s7Count/total*100)}% of total`, onClick: () => setActiveStatus('s7 - Project Deliverd') },
            { label: 'Child (FED)', val: childCount, color: '#F7B84F', sub: 'linked to squads', onClick: undefined },
          ].map(({ label, val, color, sub, onClick }) => (
            <div key={label} onClick={onClick}
              style={{ background: '#161B25', border: '1px solid #2A3448', borderRadius: 14, padding: '14px 16px', cursor: onClick ? 'pointer' : 'default' }}>
              <div style={{ fontSize: 11, color: '#8A9BC4', textTransform: 'uppercase', letterSpacing: .5, fontWeight: 500, marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 500, color, fontFamily: 'var(--mono)' }}>{val}</div>
              <div style={{ fontSize: 11, color: '#4A5878', marginTop: 4 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* ── Content + Sidebar ──────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>

          {/* Issues panel */}
          <div style={{ background: '#161B25', border: '1px solid #2A3448', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A3448', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Issues</span>
              <span style={{ fontSize: 11, color: '#4A5878', fontFamily: 'var(--mono)' }}>{filtered.length} issues</span>
            </div>
            <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
              {view === 'list' ? <ListView issues={filtered} childMap={childMap} expanded={expanded} toggle={toggle} openModal={openModal} /> : <KanbanView issues={filtered} childMap={childMap} openModal={openModal} />}
            </div>
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Status progress */}
            <div style={{ background: '#161B25', border: '1px solid #2A3448', borderRadius: 14 }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A3448', fontSize: 13, fontWeight: 500 }}>Progress by Status</div>
              <div style={{ padding: '12px 16px' }}>
                {STATUS_ORDER.filter(s => statusCounts[s]).map(s => (
                  <div key={s} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: '#8A9BC4' }}>{STATUS_SHORT[s] || s}</span>
                      <span style={{ fontSize: 11, color: '#4A5878', fontFamily: 'var(--mono)' }}>{statusCounts[s]}</span>
                    </div>
                    <div style={{ height: 4, background: '#242B3D', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round((statusCounts[s] || 0) / total * 100)}%`, height: '100%', background: STATUS_COLOR[s], borderRadius: 2, transition: 'width .5s' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Assignees */}
            <div style={{ background: '#161B25', border: '1px solid #2A3448', borderRadius: 14 }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #2A3448', fontSize: 13, fontWeight: 500 }}>Top Assignees</div>
              <div style={{ padding: '12px 16px' }}>
                {assigneeCounts.map(([name, count], i) => {
                  const colors = ['#4F8EF7','#9B7EF7','#4FDEF7','#3DD68C','#F7B84F','#E070C8','#F75F5F']
                  const max = assigneeCounts[0]?.[1] || 1
                  return (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: '#8A9BC4', width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{name}</span>
                      <div style={{ flex: 1, height: 6, background: '#242B3D', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${count / max * 100}%`, height: '100%', background: colors[i % colors.length], borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, color: '#4A5878', fontFamily: 'var(--mono)', width: 18, textAlign: 'right' }}>{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── Modal ──────────────────────────────────────────────────────── */}
      {modal && (
        <div onClick={e => { if (e.target === e.currentTarget) setModal(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#161B25', border: '1px solid #3A4560', borderRadius: 14, maxWidth: 680, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A3448', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#161B25' }}>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#4A5878' }}>{modal.key}</div>
                <div style={{ fontSize: 15, fontWeight: 500, marginTop: 2 }}>{modal.fields.summary}</div>
              </div>
              <button onClick={() => setModal(null)} style={{ background: 'transparent', border: 'none', color: '#8A9BC4', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              <ModalContent issue={modal} detail={modalDetail} childMap={childMap} loading={modalLoading} openChild={openModal} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── List View ────────────────────────────────────────────────────────────────
function ListView({ issues, childMap, expanded, toggle, openModal }: {
  issues: JiraIssue[]; childMap: Record<string, JiraIssue>; expanded: Set<string>
  toggle: (k: string) => void; openModal: (i: JiraIssue) => void
}) {
  if (!issues.length) return <div style={{ padding: 40, textAlign: 'center', color: '#4A5878' }}>ไม่พบ Issue ที่ตรงเงื่อนไข</div>
  return (
    <div>
      {issues.map(issue => {
        const f = issue.fields
        const s = f.status.name
        const children = linkedFedKeys(issue).map(k => childMap[k]).filter(Boolean)
        const prog = childProgress(children)
        const isExp = expanded.has(issue.key)
        const aName = shortName(f.assignee?.displayName || '')
        const pri = f.priority?.name || ''
        return (
          <div key={issue.key} onClick={() => toggle(issue.key)}
            style={{ padding: '11px 16px', borderBottom: '1px solid #2A3448', cursor: 'pointer', background: isExp ? '#1E2535' : 'transparent', transition: 'background .15s' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: 4, background: '#1E1A2A', color: '#9B7EF7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, flexShrink: 0, marginTop: 1 }}>E</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#4A5878' }}>{issue.key}</span>
                    <Badge label={STATUS_SHORT[s] || s} color={STATUS_COLOR[s] || '#8A9BC4'} bg={STATUS_BG[s] || '#1E2535'} />
                    {pri && <Badge label={pri} color={PRI_COLOR[pri] || '#8A9BC4'} bg={PRI_BG[pri] || '#1E2535'} />}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {children.length > 0 && <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: '#4A5878', background: '#1E2535', border: '1px solid #2A3448', padding: '1px 5px', borderRadius: 3 }}>{children.length} child</span>}
                    {prog && <ProgressBar pct={prog.pct} color={prog.pct === 100 ? '#3DD68C' : '#4F8EF7'} />}
                  </div>
                </div>
                <div style={{ fontSize: 13, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.summary}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                  {aName && <Badge label={aName} color="#8A9BC4" bg="#1E2535" />}
                  <span style={{ fontSize: 10, color: '#4A5878' }}>{fmtDate(f.updated)}</span>
                  <a href={`${JIRA_URL}${issue.key}`} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                    style={{ fontSize: 10, color: '#4F8EF7', fontFamily: 'var(--mono)' }}>{issue.key} ↗</a>
                  <button onClick={e => { e.stopPropagation(); openModal(issue) }}
                    style={{ fontSize: 10, color: '#9B7EF7', background: 'transparent', border: '1px solid #3A3A5A', padding: '1px 7px', borderRadius: 4, cursor: 'pointer' }}>detail</button>
                </div>
                {/* Children expanded */}
                {isExp && (
                  <div style={{ marginTop: 8, background: '#0F1117', border: '1px solid #2A3448', borderRadius: 8, padding: 8 }}>
                    {children.length === 0
                      ? <div style={{ fontSize: 12, color: '#4A5878', padding: 6, textAlign: 'center' }}>ไม่มี FED Child Issues</div>
                      : <>
                          <div style={{ fontSize: 10, color: '#4A5878', textTransform: 'uppercase', letterSpacing: .5, padding: '2px 6px 6px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Child Issues — Dev Squads</span>
                            {prog && <span style={{ fontFamily: 'var(--mono)', color: prog.pct === 100 ? '#3DD68C' : '#4F8EF7' }}>{prog.done}/{prog.total} done · {prog.pct}%</span>}
                          </div>
                          {children.map(c => {
                            const cs = c.fields.status.name
                            const ca = shortName(c.fields.assignee?.displayName || '')
                            return (
                              <div key={c.key} onClick={e => { e.stopPropagation(); openModal(c) }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', transition: 'background .15s' }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#1E2535')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#4A5878', minWidth: 70 }}>{c.key}</span>
                                <span style={{ flex: 1, fontSize: 11, color: '#8A9BC4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.fields.summary}</span>
                                <Badge label={cs} color={CHILD_STATUS_COLOR[cs] || '#8A9BC4'} bg={CHILD_STATUS_BG[cs] || '#1E2535'} />
                                {ca && <span style={{ fontSize: 10, color: '#4A5878', whiteSpace: 'nowrap', minWidth: 60, textAlign: 'right' }}>{ca}</span>}
                              </div>
                            )
                          })}
                        </>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Kanban View ──────────────────────────────────────────────────────────────
function KanbanView({ issues, childMap, openModal }: { issues: JiraIssue[]; childMap: Record<string, JiraIssue>; openModal: (i: JiraIssue) => void }) {
  const cols: Record<string, JiraIssue[]> = {}
  STATUS_ORDER.forEach(s => { cols[s] = [] })
  issues.forEach(i => { const s = i.fields.status.name; if (!cols[s]) cols[s] = []; cols[s].push(i) })
  const active = STATUS_ORDER.filter(s => cols[s]?.length)
  if (!active.length) return <div style={{ padding: 40, textAlign: 'center', color: '#4A5878' }}>ไม่พบ Issue</div>
  return (
    <div style={{ padding: 12, overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 10, minWidth: 'max-content' }}>
        {active.map(s => {
          const col = STATUS_COLOR[s]; const bg = STATUS_BG[s]
          return (
            <div key={s} style={{ width: 210, flexShrink: 0 }}>
              <div style={{ padding: '7px 10px', background: bg, borderRadius: '8px 8px 0 0', fontSize: 11, fontWeight: 500, color: col, display: 'flex', justifyContent: 'space-between' }}>
                <span>{STATUS_SHORT[s] || s}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{cols[s].length}</span>
              </div>
              <div style={{ background: '#1E2535', borderRadius: '0 0 8px 8px', padding: 6, display: 'flex', flexDirection: 'column', gap: 5, minHeight: 60 }}>
                {cols[s].slice(0, 20).map(i => {
                  const children = linkedFedKeys(i).map(k => childMap[k]).filter(Boolean)
                  const prog = childProgress(children)
                  const aName = shortName(i.fields.assignee?.displayName || '')
                  const ini = initials(i.fields.assignee?.displayName || '')
                  return (
                    <div key={i.key} onClick={() => openModal(i)}
                      style={{ background: '#161B25', border: '1px solid #2A3448', borderRadius: 7, padding: 9, cursor: 'pointer', fontSize: 12 }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = '#3A4560')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = '#2A3448')}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#4A5878', marginBottom: 3 }}>{i.key}</div>
                      <div style={{ lineHeight: 1.4, color: '#E8EDF8' }}>{(i.fields.summary || '').slice(0, 55)}{(i.fields.summary || '').length > 55 ? '…' : ''}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        {ini ? <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#1A2744', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 500, color: '#4F8EF7' }}>{ini}</div> : <span />}
                        {prog ? <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: prog.pct === 100 ? '#3DD68C' : '#4A5878' }}>{prog.pct}%</span> : children.length ? <span style={{ fontSize: 9, color: '#4A5878' }}>{children.length}ch</span> : <span />}
                      </div>
                    </div>
                  )
                })}
                {cols[s].length > 20 && <div style={{ fontSize: 11, color: '#4A5878', textAlign: 'center', padding: 4 }}>+{cols[s].length - 20} more</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Modal Content ────────────────────────────────────────────────────────────
function ModalContent({ issue, detail, childMap, loading, openChild }: {
  issue: JiraIssue; detail: JiraIssue | null; childMap: Record<string, JiraIssue>
  loading: boolean; openChild: (i: JiraIssue) => void
}) {
  const f = issue.fields
  const s = f.status.name
  const pri = f.priority?.name || ''
  const children = linkedFedKeys(issue).map(k => childMap[k]).filter(Boolean)
  const prog = childProgress(children)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge label={STATUS_SHORT[s] || s} color={STATUS_COLOR[s] || '#8A9BC4'} bg={STATUS_BG[s] || '#1E2535'} />
        {pri && <Badge label={pri} color={PRI_COLOR[pri] || '#8A9BC4'} bg={PRI_BG[pri] || '#1E2535'} />}
        {f.assignee && <Badge label={shortName(f.assignee.displayName)} color="#8A9BC4" bg="#1E2535" />}
        <a href={`${JIRA_URL}${issue.key}`} target="_blank" rel="noopener" style={{ fontSize: 11, color: '#4F8EF7', fontFamily: 'var(--mono)', alignSelf: 'center' }}>เปิดใน Jira ↗</a>
      </div>

      {children.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#4A5878', textTransform: 'uppercase', letterSpacing: .5, fontWeight: 500, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>Child Issues {children.length > 0 && `(${children.length})`}</span>
            {prog && <span style={{ fontFamily: 'var(--mono)', color: prog.pct === 100 ? '#3DD68C' : '#4F8EF7' }}>{prog.done}/{prog.total} done · {prog.pct}%</span>}
          </div>
          {prog && (
            <div style={{ height: 5, background: '#242B3D', borderRadius: 3, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ width: `${prog.pct}%`, height: '100%', background: prog.pct === 100 ? '#3DD68C' : '#4F8EF7', borderRadius: 3, transition: 'width .4s' }} />
            </div>
          )}
          {children.map(c => {
            const cs = c.fields.status.name
            const ca = shortName(c.fields.assignee?.displayName || '')
            return (
              <div key={c.key} onClick={() => openChild(c)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 7, marginBottom: 4, background: '#1E2535', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#242B3D')}
                onMouseLeave={e => (e.currentTarget.style.background = '#1E2535')}>
                <a href={`${JIRA_URL}${c.key}`} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                  style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#4F8EF7', minWidth: 76 }}>{c.key}</a>
                <span style={{ flex: 1, fontSize: 12, color: '#8A9BC4' }}>{c.fields.summary}</span>
                <Badge label={cs} color={CHILD_STATUS_COLOR[cs] || '#8A9BC4'} bg={CHILD_STATUS_BG[cs] || '#1E2535'} />
                {ca && <span style={{ fontSize: 11, color: '#4A5878', whiteSpace: 'nowrap' }}>{ca}</span>}
              </div>
            )
          })}
        </div>
      )}

      {loading && <div style={{ color: '#4A5878', fontSize: 13 }}>กำลังโหลดรายละเอียด…</div>}

      {detail && (
        <div style={{ fontSize: 11, color: '#4A5878', fontFamily: 'var(--mono)', paddingTop: 8, borderTop: '1px solid #2A3448' }}>
          Updated: {fmtDate(detail.fields.updated)} · Created: {fmtDate(detail.fields.created)}
        </div>
      )}
    </div>
  )
}
