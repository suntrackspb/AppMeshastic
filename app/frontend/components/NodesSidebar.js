export default {
  name: 'NodesSidebar',
  props: {
    connectedNodes: Array,
    activeNodeId: String,
    meshNodes: Array,
    mirrorConnected: { type: Boolean, default: false },
    unreadByNode: { type: Object, default: () => ({}) },
  },
  emits: ['select-node', 'add-node', 'open-settings', 'toggle-mirror', 'open-dm', 'show-node-info', 'disconnect-node'],
  data() {
    return { search: '' }
  },
  computed: {
    filteredNodes() {
      const q = this.search.trim().toLowerCase()
      const sorted = [...this.meshNodes].sort((a, b) => {
        if (b.is_favorite !== a.is_favorite) return (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0)
        const ta = a.last_seen_at || ''
        const tb = b.last_seen_at || ''
        return tb > ta ? 1 : tb < ta ? -1 : 0
      })
      if (!q) return sorted.slice(0, 20)
      return sorted.filter(n =>
        (n.long_name || '').toLowerCase().includes(q) ||
        (n.short_name || '').toLowerCase().includes(q) ||
        (n.node_id || '').toLowerCase().includes(q)
      )
    },
  },
  template: `
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Ноды</span>
        <div class="sidebar-header-actions">
          <label class="mirror-toggle" v-tooltip="mirrorConnected ? 'Отключить зеркало эфира' : 'Подключить зеркало эфира'">
            <span class="mirror-toggle-label">🌐</span>
            <input type="checkbox" :checked="mirrorConnected" @change="$emit('toggle-mirror')" />
            <span class="mirror-toggle-track"><span class="mirror-toggle-thumb"></span></span>
          </label>
          <button class="btn-icon" @click="$emit('open-settings')" v-tooltip="'Настройки'">⚙️</button>
          <button class="btn-icon" @click="$emit('add-node')" v-tooltip="'Подключить ноду'">📟</button>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-label">Подключённые</div>
        <div
          v-for="nodeId in connectedNodes"
          :key="nodeId"
          class="node-item"
          :class="{ active: nodeId === activeNodeId }"
          @click="$emit('select-node', nodeId)"
        >
          <span class="node-dot connected"></span>
          <span class="node-name">{{ nodeId }}</span>
          <span v-if="unreadByNode[nodeId]" class="unread-badge node-unread-badge">{{ unreadByNode[nodeId] }}</span>
          <button class="btn-icon node-disconnect-btn" @click.stop="$emit('disconnect-node', nodeId)" v-tooltip="'Отключить ноду'">⏏</button>
        </div>
        <div v-if="!connectedNodes.length" class="sidebar-empty">Нет подключений</div>
      </div>

      <div class="sidebar-section" v-if="meshNodes.length">
        <div class="sidebar-label">В сети ({{ meshNodes.length }})</div>
        <input
          v-model="search"
          class="nodes-search"
          placeholder="Поиск по имени или ID..."
        />
        <div
          v-for="node in filteredNodes"
          :key="node.node_id"
          class="node-item mesh-node"
          style="cursor:pointer"
          @click="$emit('show-node-info', node)"
        >
          <span class="node-dot" :class="{ online: isOnline(node) }"></span>
          <div class="node-info">
            <span class="node-name">{{ node.long_name || node.node_id }}</span>
            <span class="node-short">{{ node.short_name }}</span>
            <span class="node-lastseen" v-if="node.last_seen_at">{{ formatLastSeen(node.last_seen_at) }}</span>
          </div>
          <button v-if="node.public_key" class="node-dm-btn" @click.stop="$emit('open-dm', node)" v-tooltip="'Личное сообщение'">✉️</button>
          <svg v-if="node.public_key" class="node-lock" viewBox="0 0 960 960" width="14" height="14" v-tooltip="'Зашифровано'"><path fill="#4caf50" d="M240,880Q207,880 183.5,856.5Q160,833 160,800L160,400Q160,367 183.5,343.5Q207,320 240,320L280,320L280,240Q280,157 338.5,98.5Q397,40 480,40Q563,40 621.5,98.5Q680,157 680,240L680,320L720,320Q753,320 776.5,343.5Q800,367 800,400L800,800Q800,833 776.5,856.5Q753,880 720,880L240,880ZM480,680Q513,680 536.5,656.5Q560,633 560,600Q560,567 536.5,543.5Q513,520 480,520Q447,520 423.5,543.5Q400,567 400,600Q400,633 423.5,656.5Q447,680 480,680ZM360,320L600,320L600,240Q600,190 565,155Q530,120 480,120Q430,120 395,155Q360,190 360,240L360,320Z"/></svg>
          <svg v-else class="node-lock" viewBox="0 0 960 960" width="14" height="14" v-tooltip="'Без шифрования'"><path fill="#f44336" d="M240,880Q207,880 183.5,856.5Q160,833 160,800L160,400Q160,367 183.5,343.5Q207,320 240,320L600,320L600,240Q600,190 565,155Q530,120 480,120Q438,120 406.5,145.5Q375,171 364,209Q360,223 347.5,231.5Q335,240 320,240Q303,240 291.5,229Q280,218 283,203Q294,135 349.5,87.5Q405,40 480,40Q563,40 621.5,98.5Q680,157 680,240L680,320L720,320Q753,320 776.5,343.5Q800,367 800,400L800,800Q800,833 776.5,856.5Q753,880 720,880L240,880ZM480,680Q513,680 536.5,656.5Q560,633 560,600Q560,567 536.5,543.5Q513,520 480,520Q447,520 423.5,543.5Q400,567 400,600Q400,633 423.5,656.5Q447,680 480,680Z"/></svg>
        </div>
        <div v-if="search && !filteredNodes.length" class="sidebar-empty">Не найдено</div>
        <div v-if="!search && meshNodes.length > 20" class="sidebar-more">
          ещё {{ meshNodes.length - 20 }} нод...
        </div>
      </div>
    </aside>
  `,
  methods: {
    isOnline(node) {
      if (!node.last_seen_at) return false
      const ts = node.last_seen_at.slice(0, 23)
      const diff = Date.now() - new Date(ts + 'Z').getTime()
      return diff < 30 * 60 * 1000
    },
    formatLastSeen(ts) {
      return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    },
  },
}
