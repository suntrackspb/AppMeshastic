export default {
  name: 'DcpToggle',
  props: {
    label: { type: String, required: true },
    desc: { type: String, default: null },
    modelValue: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  template: `
    <div class="dcp-toggle-row">
      <div class="dcp-toggle-info">
        <span class="dcp-toggle-label">{{ label }}</span>
        <span v-if="desc" class="dcp-toggle-desc">{{ desc }}</span>
      </div>
      <label class="dcp-switch">
        <input type="checkbox" :checked="modelValue"
          @change="$emit('update:modelValue', $event.target.checked)" />
        <span class="dcp-switch-track"></span>
      </label>
    </div>
  `,
}
