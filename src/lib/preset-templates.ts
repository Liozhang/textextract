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
      { key: '\u68C0\u67E5\u65E5\u671F', type: 'string', description: '\u68C0\u67E5/\u62A5\u544A\u65E5\u671F', example: '2024-01-15' },
      { key: '\u6837\u672C\u7F16\u53F7/\u75C5\u7406\u6837\u672C\u7F16\u53F7', type: 'string', description: '\u6837\u672C\u7F16\u53F7\u6216\u75C5\u7406\u6837\u672C\u7F16\u53F7', example: 'S2024-001' },
      { key: '\u68C0\u9A8C\u5927\u7C7B/\u75C5\u7406\u5927\u7C7B/\u8BCA\u65AD\u5927\u7C7B', type: 'string', description: '\u68C0\u9A8C\u5927\u7C7B\u3001\u75C5\u7406\u5927\u7C7B\u6216\u8BCA\u65AD\u5927\u7C7B', example: '\u751F\u5316\u68C0\u9A8C' },
      { key: '\u68C0\u9A8C\u9879\u76EE/\u75C5\u7406\u9879\u76EE/\u8BCA\u65AD\u9879\u76EE', type: 'string', description: '\u68C0\u9A8C\u9879\u76EE\u3001\u75C5\u7406\u9879\u76EE\u6216\u8BCA\u65AD\u9879\u76EE', example: '\u767D\u7EC6\u80CC', repeating: true },
      { key: '\u68C0\u9A8C\u7ED3\u679C/\u75C5\u7406\u63CF\u8FF0/\u8BCA\u65AD\u63CF\u8FF0', type: 'string', description: '\u68C0\u9A8C\u7ED3\u679C\u3001\u75C5\u7406\u63CF\u8FF0\u6216\u8BCA\u65AD\u63CF\u8FF0', example: '6.5 \u00D710\u2079/L', repeating: true },
      { key: '\u53C2\u8003\u533A\u95F4', type: 'string', description: '\u6B63\u5E38\u53C2\u8003\u8303\u56F4', example: '3.5-9.5', repeating: true },
      { key: '\u5F02\u5E38\u6807\u8BB0', type: 'string', description: '\u5F02\u5E38\u6807\u8BB0\uFF08\u2191/\u2193/\u65E0\uFF09', example: '\u2191', repeating: true },
      { key: '\u6837\u672C\u7C7B\u578B', type: 'string', description: '\u6837\u672C\u7C7B\u578B\uFF08\u8840\u6DB2\u3001\u7EC4\u7EC7\u7B49\uFF09', example: '\u8840\u6DB2' },
      { key: '\u68C0\u6D4B\u65B9\u6CD5', type: 'string', description: '\u68C0\u6D4B\u65B9\u6CD5', example: '\u5316\u5B66\u53D1\u5149\u6CD5' },
      { key: '\u5907\u6CE8', type: 'string', description: '\u5907\u6CE8\u4FE1\u606F', example: '' },
      { key: '\u62A5\u544A\u7F16\u53F7/\u75C5\u7406\u62A5\u544A\u7F16\u53F7', type: 'string', description: '\u62A5\u544A\u7F16\u53F7\u6216\u75C5\u7406\u62A5\u544A\u7F16\u53F7', example: 'P2024-001' },
    ],
  },
  {
    id: 'blood-routine',
    name: '\u8840\u5E38\u89C4',
    description: '\u8840\u5E38\u89C4\u68C0\u67E5\uFF08\u957F\u683C\u5F0F\uFF09',
    columns: [
      { key: '\u59D3\u540D', type: 'string', description: '\u60A3\u8005\u59D3\u540D', example: '\u674E\u56DB' },
      { key: '\u6027\u522B', type: 'string', description: '\u60A7\u522B', example: '\u7537' },
      { key: '\u5E74\u9F84', type: 'string', description: '\u5E74\u9F84', example: '45\u5C81' },
      { key: '\u68C0\u9A8C\u65E5\u671F', type: 'string', description: '\u68C0\u9A8C\u65E5\u671F', example: '2024-01-15' },
      { key: '\u68C0\u9A8C\u9879\u76EE', type: 'string', description: '\u8840\u5E38\u89C4\u9879\u76EE\u540D\u79F0', example: '\u767D\u7EC6\u80CC', repeating: true },
      { key: '\u68C0\u9A8C\u7ED3\u679C', type: 'string', description: '\u68C0\u9A8C\u7ED3\u679C\u503C', example: '6.5 \u00D710\u2079/L', repeating: true },
      { key: '\u53C2\u8003\u8303\u56F4', type: 'string', description: '\u6B63\u5E38\u53C2\u8003\u8303\u56F4', example: '3.5-9.5', repeating: true },
      { key: '\u5355\u4F4D', type: 'string', description: '\u68C0\u9A8C\u7ED3\u679C\u5355\u4F4D', example: '\u00D710\u2079/L', repeating: true },
    ],
  },
  {
    id: 'medical-record',
    name: '\u75C5\u5386',
    description: '\u60A3\u8005\u75C5\u5386\u4FE1\u606F\uFF08\u5355\u884C\uFF09',
    columns: [
      { key: '\u59D3\u540D', type: 'string', description: '\u60A3\u8005\u59D3\u540D', example: '\u738B\u4E94' },
      { key: '\u6027\u522B', type: 'string', description: '\u6027\u522B', example: '\u5973' },
      { key: '\u5E74\u9F84', type: 'string', description: '\u5E74\u9F84', example: '60\u5C81' },
      { key: '\u5C31\u8BCA\u65E5\u671F', type: 'string', description: '\u5C31\u8BCA\u65E5\u671F', example: '2024-01-15' },
      { key: '\u79D1\u5BA4', type: 'string', description: '\u5C31\u8BCA\u79D1\u5BA4', example: '\u5FC3\u5185\u79D1' },
      { key: '\u4E3B\u8BC9', type: 'string', description: '\u4E3B\u8BC9', example: '\u53CD\u590D\u80F8\u95F73\u5929' },
      { key: '\u73B0\u75C5\u53F2', type: 'string', description: '\u73B0\u75C5\u53F2', example: '3\u5929\u524D\u65E0\u660E\u539F\u56E0\u51FA\u73B0\u80F8\u95F7' },
      { key: '\u8BCA\u65AD', type: 'string', description: '\u8BCA\u65AD', example: '\u51A0\u5FC3\u75C5' },
    ],
  },
  {
    id: 'invoice',
    name: '\u53D1\u7968',
    description: '\u589E\u503C\u7A0E\u53D1\u7968\uFF08\u5355\u884C\uFF09',
    columns: [
      { key: '\u53D1\u7968\u540D\u79F0', type: 'string', description: '\u53D1\u7968\u540D\u79F0', example: '\u6C5F\u82CF\u589E\u503C\u7A0E\u666E\u901A\u53D1\u7968' },
      { key: '\u53D1\u7968\u4EE3\u7801', type: 'string', description: '\u53D1\u7968\u4EE3\u7801', example: '032001800111' },
      { key: '\u5F00\u7968\u65E5\u671F', type: 'string', description: '\u5F00\u7968\u65E5\u671F', example: '2024-01-15' },
      { key: '\u8D2D\u4E70\u65B9', type: 'string', description: '\u8D2D\u4E70\u65B9\u540D\u79F0', example: 'XX\u79D1\u6280\u6709\u9650\u516C\u53F8' },
      { key: '\u9500\u552E\u65B9', type: 'string', description: '\u9500\u552E\u65B9\u540D\u79F0', example: 'XX\u5546\u8D38\u6709\u9650\u516C\u53F8' },
      { key: '\u91D1\u989D', type: 'number', description: '\u4E0D\u542B\u7A0E\u91D1\u989D', example: '1000.00' },
      { key: '\u7A0E\u7387', type: 'string', description: '\u7A0E\u7387', example: '13%' },
      { key: '\u7A0E\u989D', type: 'number', description: '\u7A0E\u989D', example: '130.00' },
      { key: '\u4EF7\u7A0E\u5408\u8BA1', type: 'number', description: '\u4EF7\u7A0E\u5408\u8BA1', example: '1130.00' },
    ],
  },
];
