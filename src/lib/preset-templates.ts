import type { ColumnConstraint } from './store';

export interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  columns: ColumnConstraint[];
}

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: 'clinical-report',
    name: '\u4E34\u5E8A\u62A5\u544A',
    description: '\u7EDF\u4E00\u6A21\u677F\uFF08\u68C0\u9A8C\u62A5\u544A + \u75C5\u7406\u62A5\u544A + \u8BCA\u65AD\u62A5\u544A\uFF09',
    columns: [
      { key: '\u5E8A\u53F7', type: 'string', description: '\u4F4F\u9662\u5E8A\u53F7', example: '32' },
      { key: '\u75C5\u6848\u53F7', type: 'string', description: '\u75C5\u6848\u7F16\u53F7', example: '2024001' },
      { key: '\u59D3\u540D', type: 'string', description: '\u60A3\u8005\u59D3\u540D', example: '\u5F20\u4E09' },
      { key: '\u6027\u522B', type: 'string', description: '\u6027\u522B', example: '\u7537' },
      { key: '\u51FA\u751F\u5E74\u6708', type: 'string', description: '\u51FA\u751F\u5E74\u6708', example: '1950-03' },
      { key: '\u5E74\u9F84', type: 'string', description: '\u5E74\u9F84', example: '74\u5C81' },
      { key: '\u68C0\u67E5\u65E5\u671F', type: 'string', description: '\u68C0\u67E5/\u62A5\u544A\u65E5\u671F', example: '2024-01-15', repeating: true },
      { key: '\u6837\u672C\u7F16\u53F7/\u75C5\u7406\u6837\u672C\u7F16\u53F7', type: 'string', description: '\u6837\u672C\u7F16\u53F7/\u75C5\u7406\u6837\u672C\u7F16\u53F7', example: 'S2024-001/B2024-015', repeating: true },
      { key: '\u68C0\u9A8C\u5927\u7C7B/\u75C5\u7406\u5927\u7C7B/\u8BCA\u65AD\u5927\u7C7B', type: 'string', description: '\u68C0\u9A8C\u5927\u7C7B/\u75C5\u7406\u5927\u7C7B/\u8BCA\u65AD\u5927\u7C7B', example: '\u751F\u5316\u68C0\u9A8C/\u7EC4\u7EC7\u75C5\u7406\u68C0\u67E5/\u5F71\u50CF\u8BCA\u65AD', repeating: true },
      { key: '\u68C0\u9A8C\u9879\u76EE/\u75C5\u7406\u9879\u76EE/\u8BCA\u65AD\u9879\u76EE', type: 'string', description: '\u68C0\u9A8C\u9879\u76EE/\u75C5\u7406\u9879\u76EE/\u8BCA\u65AD\u9879\u76EE', example: '\u767D\u7EC6\u80CC/(左乳)肿块穿刺活检/CT\u5E73\u626B', repeating: true },
      { key: '\u68C0\u9A8C\u7ED3\u679C/\u75C5\u7406\u63CF\u8FF0\u6BB5\u843D/\u8BCA\u65AD\u63CF\u8FF0\u6BB5\u843D', type: 'string', description: '\u68C0\u9A8C\u7ED3\u679C/\u75C5\u7406\u63CF\u8FF0\u6BB5\u843D/\u8BCA\u65AD\u63CF\u8FF0\u6BB5\u843D', example: '6.5\u00D710\u2079/L/\u3010\u8089\u773C\u6240\u89C1\u3011\u7070\u767D\u7C89\u672B\u6837\u7EC4\u7EC7\uFF0C2.5\u00D71.8\u00D71.5cm\u3002\u3010\u955C\u4E0B\u6240\u89C1\u3011\u6D78\u6DA6\u6027\u5BFC\u7BA1\u764C\uFF0C\u7EC4\u7EC7\u5B66\u5206\u7EA7\u2162\u7EA7\u3002\u3010\u6DCB\u5DF4\u7ED3\u9001\u68C0\u3011\u6DCB\u5DF4\u7ED3(0/15)\u672A\u89C1\u8F6C\u79FB\u3002/CT\u793A\u53F3\u4E0A\u80BA\u5708\u5F62\u9AD8\u5BC6\u5EA6\u5F71', repeating: true },
      { key: '\u53C2\u8003\u533A\u95F4', type: 'string', description: '\u6B63\u5E38\u53C2\u8003\u8303\u56F4', example: '3.5-9.5', repeating: true },
      { key: '\u5F02\u5E38\u6807\u8BB0', type: 'string', description: '\u5F02\u5E38\u6807\u8BB0\uFF08\u2191/\u2193/\u65E0\uFF09', example: '\u2191', repeating: true },
      { key: '\u6837\u672C\u7C7B\u578B', type: 'string', description: '\u6837\u672C\u7C7B\u578B\uFF08\u8840\u6DB2\u3001\u7EC4\u7EC7\u7B49\uFF09', example: '\u8840\u6DB2/\u7A7F\u523A\u7EC4\u7EC7', repeating: true },
      { key: '\u68C0\u6D4B\u65B9\u6CD5', type: 'string', description: '\u68C0\u6D4B\u65B9\u6CD5', example: '\u5316\u5B66\u53D1\u5149\u6CD5/HE\u67D3\u8272/CT\u5E73\u626B', repeating: true },
      { key: '\u5907\u6CE8', type: 'string', description: '\u5907\u6CE8\u4FE1\u606F', example: '', repeating: true },
      { key: '\u62A5\u544A\u7F16\u53F7/\u75C5\u7406\u62A5\u544A\u7F16\u53F7', type: 'string', description: '\u62A5\u544A\u7F16\u53F7/\u75C5\u7406\u62A5\u544A\u7F16\u53F7', example: 'P2024-001/SP2024-020', repeating: true },
    ],
  },
];
