'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  FileText,
  Sparkles,
  Briefcase,
  Stethoscope,
} from 'lucide-react';
import { useStore, type TemplateField } from '@/lib/store';
import { useT } from '@/lib/i18n';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ---------------------------------------------------------------------------
// Preset templates
// ---------------------------------------------------------------------------

interface PresetTemplate {
  prompt: string;
  fields: TemplateField[];
}

const PRESET_TEMPLATES: Record<string, PresetTemplate> = {
  // =========================================================================
  // 商务办公类
  // =========================================================================
  合同信息: {
    prompt: '请提取合同的关键信息',
    fields: [
      { name: '合同编号', type: 'string', required: true },
      { name: '签订日期', type: 'string', required: true },
      { name: '甲方', type: 'string', required: true },
      { name: '乙方', type: 'string', required: true },
      { name: '合同金额', type: 'string', required: true },
      { name: '有效期', type: 'string', required: false },
    ],
  },
  人员信息: {
    prompt: '请提取人员的基本信息',
    fields: [
      { name: '姓名', type: 'string', required: true },
      { name: '性别', type: 'string', required: true },
      { name: '年龄', type: 'number', required: false },
      { name: '职位', type: 'string', required: true },
      { name: '部门', type: 'string', required: false },
      { name: '联系方式', type: 'string', required: false },
    ],
  },
  发票信息: {
    prompt: '请提取发票的关键信息',
    fields: [
      { name: '发票号码', type: 'string', required: true },
      { name: '开票日期', type: 'string', required: true },
      { name: '买方名称', type: 'string', required: true },
      { name: '卖方名称', type: 'string', required: true },
      { name: '金额', type: 'number', required: true },
      { name: '税额', type: 'number', required: false },
      { name: '价税合计', type: 'number', required: true },
    ],
  },

  // =========================================================================
  // 科研临床类
  // =========================================================================
  临床试验数据: {
    prompt: '请从临床试验报告或病例报告表（CRF）中提取以下关键临床数据，确保数值精度和时间格式的准确性',
    fields: [
      { name: '受试者编号', type: 'string', required: true, description: '临床试验中分配的唯一编号' },
      { name: '研究中心', type: 'string', required: true, description: '开展试验的医院或机构名称' },
      { name: '入组日期', type: 'date', required: true, description: '受试者签署知情同意并入组的日期' },
      { name: '年龄', type: 'number', required: true, description: '入组时的年龄' },
      { name: '性别', type: 'string', required: true, description: '男/女' },
      { name: '诊断', type: 'string', required: true, description: '纳入试验的主要诊断' },
      { name: '分期', type: 'string', required: false, description: '疾病分期（如 I/II/III/IV 期）' },
      { name: '试验组别', type: 'string', required: true, description: '试验组/对照组/开放标签' },
      { name: '治疗方案', type: 'string', required: true, description: '药物名称、剂量、给药途径和频率' },
      { name: '基线指标', type: 'string', required: false, description: '入组时的关键基线测量值' },
      { name: '疗效评估', type: 'string', required: false, description: '主要终点和次要终点的测量结果' },
      { name: '不良事件', type: 'array', required: false, description: '发生的不良事件列表，包含事件名称和严重程度' },
      { name: '严重不良事件', type: 'boolean', required: false, description: '是否发生严重不良事件（SAE）' },
      { name: '完成状态', type: 'string', required: true, description: '已完成/提前终止/脱落' },
      { name: '终止原因', type: 'string', required: false, description: '若提前终止，请说明原因' },
    ],
  },
  论文信息提取: {
    prompt: '请从学术论文（期刊论文、会议论文、预印本）中提取结构化文献信息，适用于系统综述和数据荟萃分析',
    fields: [
      { name: '论文标题', type: 'string', required: true, description: '完整论文标题' },
      { name: '第一作者', type: 'string', required: true, description: '第一作者姓名' },
      { name: '通讯作者', type: 'string', required: false, description: '通讯作者姓名' },
      { name: '作者列表', type: 'array', required: false, description: '所有作者姓名列表' },
      { name: '发表期刊', type: 'string', required: true, description: '期刊或会议名称' },
      { name: '发表年份', type: 'number', required: true, description: '论文发表或接受年份' },
      { name: 'DOI', type: 'string', required: false, description: '数字对象唯一标识符' },
      { name: '研究类型', type: 'string', required: true, description: 'RCT/队列研究/病例对照/横断面/Meta分析等' },
      { name: '样本量', type: 'number', required: true, description: '总样本量（研究对象数量）' },
      { name: '研究对象', type: 'string', required: true, description: '研究人群描述（如：2型糖尿病患者，18-65岁）' },
      { name: '干预措施', type: 'string', required: false, description: '试验组的干预/暴露内容' },
      { name: '对照措施', type: 'string', required: false, description: '对照组的干预/对照内容' },
      { name: '主要结局指标', type: 'string', required: true, description: '主要终点指标及其测量方法' },
      { name: '效应量', type: 'string', required: false, description: '主要结局的效应量（OR/RR/HR/MD/SMD）及95%CI' },
      { name: 'P值', type: 'string', required: false, description: '主要结局的统计显著性P值' },
      { name: '主要结论', type: 'string', required: true, description: '作者的主要研究结论摘要' },
      { name: '关键词', type: 'array', required: false, description: '论文关键词列表' },
    ],
  },
  病历信息: {
    prompt: '请从病历文档（入院记录、出院小结、病程记录）中提取关键临床信息，保持医学术语的准确性',
    fields: [
      { name: '患者姓名', type: 'string', required: true, description: '患者全名' },
      { name: '性别', type: 'string', required: true, description: '男/女' },
      { name: '年龄', type: 'number', required: true, description: '就诊时年龄' },
      { name: '住院号/病历号', type: 'string', required: true, description: '医院分配的唯一标识号' },
      { name: '入院日期', type: 'date', required: true, description: '入院日期' },
      { name: '出院日期', type: 'date', required: false, description: '出院日期' },
      { name: '主诉', type: 'string', required: true, description: '患者就诊的主要症状和持续时间' },
      { name: '现病史', type: 'string', required: true, description: '本次发病的详细经过' },
      { name: '既往史', type: 'string', required: false, description: '既往重要疾病史、手术史、输血史' },
      { name: '过敏史', type: 'string', required: false, description: '药物或食物过敏史' },
      { name: '入院诊断', type: 'array', required: true, description: '入院时的诊断列表' },
      { name: '出院诊断', type: 'array', required: false, description: '出院时的最终诊断列表' },
      { name: '手术记录', type: 'string', required: false, description: '手术名称、术式、日期' },
      { name: '用药方案', type: 'array', required: false, description: '主要用药名称、剂量、用法、疗程' },
      { name: '关键检验结果', type: 'array', required: false, description: '重要实验室检查结果（如血常规、生化、影像学）' },
      { name: '病理结果', type: 'string', required: false, description: '病理检查报告的关键发现' },
    ],
  },
  药品说明书: {
    prompt: '请从药品说明书或药品审评报告中提取结构化药物信息，确保药品名称、剂量和适应症的准确性',
    fields: [
      { name: '药品名称', type: 'string', required: true, description: '通用名/商品名' },
      { name: '英文名称', type: 'string', required: false, description: '国际非专利名（INN）' },
      { name: '剂型', type: 'string', required: true, description: '片剂/胶囊/注射液/粉针剂等' },
      { name: '规格', type: 'string', required: true, description: '每单位的含量规格' },
      { name: '适应症', type: 'array', required: true, description: '获批适应症列表' },
      { name: '用法用量', type: 'string', required: true, description: '给药途径、剂量、频率、疗程' },
      { name: '禁忌症', type: 'array', required: true, description: '使用禁忌列表' },
      { name: '不良反应', type: 'array', required: true, description: '已知不良反应及其发生率' },
      { name: '药物相互作用', type: 'array', required: false, description: '与其他药物的相互作用' },
      { name: '特殊人群用药', type: 'string', required: false, description: '孕妇/哺乳期/儿童/老年用药说明' },
      { name: '贮藏条件', type: 'string', required: false, description: '贮存温度和条件要求' },
      { name: '有效期', type: 'date', required: false, description: '药品有效期' },
    ],
  },
};

// Template categories for organized display
const TEMPLATE_CATEGORIES = [
  {
    label: '商务办公',
    icon: Briefcase,
    keys: ['合同信息', '人员信息', '发票信息'] as const,
  },
  {
    label: '科研临床',
    icon: Stethoscope,
    keys: ['临床试验数据', '论文信息提取', '病历信息', '药品说明书'] as const,
  },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TemplatePanel() {
  const t = useT();
  const template = useStore((s) => s.template);
  const setTemplate = useStore((s) => s.setTemplate);
  const addTemplateField = useStore((s) => s.addTemplateField);
  const removeTemplateField = useStore((s) => s.removeTemplateField);
  const updateTemplateField = useStore((s) => s.updateTemplateField);

  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [pendingPresetKey, setPendingPresetKey] = useState<string | null>(null);

  // Map category labels to i18n keys (TEMPLATE_CATEGORIES data kept unchanged)
  const categoryLabelMap: Record<string, string> = {
    '商务办公': t('template.categoryBusiness'),
    '科研临床': t('template.categoryClinical'),
  };

  const handleAddField = useCallback(() => {
    // Generate a unique placeholder name based on field count
    const idx = template.fields.length + 1;
    addTemplateField({
      name: t('template.fieldPlaceholder', { index: idx }),
      type: 'string',
      required: false,
      description: '',
    });
  }, [addTemplateField, template.fields.length, t]);

  const handleApplyPreset = useCallback(
    (key: string) => {
      const preset = PRESET_TEMPLATES[key];
      if (!preset) return;
      if (template.fields.length > 0) {
        setPendingPresetKey(key);
        setShowOverrideDialog(true);
        return;
      }
      setTemplate({
        prompt: preset.prompt,
        fields: preset.fields.map((f) => ({ ...f })),
      });
    },
    [setTemplate, template.fields.length],
  );

  const confirmOverride = useCallback(() => {
    if (pendingPresetKey) {
      const preset = PRESET_TEMPLATES[pendingPresetKey];
      if (preset) {
        setTemplate({
          prompt: preset.prompt,
          fields: preset.fields.map((f) => ({ ...f })),
        });
      }
    }
    setShowOverrideDialog(false);
    setPendingPresetKey(null);
  }, [pendingPresetKey, setTemplate]);

  const templateWarnings = useMemo(() => {
    const warnings: string[] = [];
    const hasPrompt = template.prompt.trim().length > 0;
    const hasFields = template.fields.length > 0;
    const hasRequired = template.fields.some((f) => f.required);
    if (!hasPrompt && hasFields) warnings.push(t('template.warnNoPrompt'));
    if (hasPrompt && !hasFields) warnings.push(t('template.warnNoFields'));
    if (hasPrompt && template.prompt.trim().length < 10) warnings.push(t('template.warnShortPrompt'));
    if (hasFields && !hasRequired) warnings.push(t('template.warnNoRequired'));
    return warnings;
  }, [template.prompt, template.fields, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-5" />
          {t('template.title')}
        </CardTitle>
        <CardDescription>{t('template.description')}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* ---------- Prompt ---------- */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="extract-prompt">{t('template.promptLabel')}</Label>
          <Textarea
            id="extract-prompt"
            placeholder={t('template.promptPlaceholder')}
            rows={4}
            value={template.prompt}
            onChange={(e) => setTemplate({ prompt: e.target.value })}
            className="resize-y"
          />
          <p className="text-muted-foreground text-right text-xs">
            {t('template.promptCount', { count: template.prompt.length })}
          </p>
        </div>

        {templateWarnings.length > 0 && (
          <div className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            {templateWarnings.map((w) => (
              <p key={w} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>
            ))}
          </div>
        )}

        <Separator />
        <div className="flex flex-col gap-4">
          <Label className="flex items-center gap-2">
            <Sparkles className="size-4" />
            {t('template.presetTemplates')}
          </Label>
          {TEMPLATE_CATEGORIES.map((cat) => {
            const CatIcon = cat.icon;
            return (
              <div key={cat.label} className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CatIcon className="size-3.5" />
                  <span className="font-medium">
                    {categoryLabelMap[cat.label] ?? cat.label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {cat.keys.map((key) => (
                    <Button
                      key={key}
                      variant="outline"
                      size="sm"
                      onClick={() => handleApplyPreset(key)}
                    >
                      {key}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <Separator />

        {/* ---------- Field Definitions ---------- */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">{t('template.fieldDefs')}</Label>
            <Button variant="outline" size="sm" onClick={handleAddField}>
              <Plus className="size-4" />
              {t('template.addField')}
            </Button>
          </div>

          {template.fields.length === 0 && (
            <p className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
              {t('template.noFields')}
            </p>
          )}

          <div className="max-h-96 flex flex-col gap-2 overflow-y-auto pr-1">
            {template.fields.map((field, index) => (
              <div
                key={`${field.name}-${index}`}
                className="bg-muted/40 flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-2"
              >
                {/* Field name */}
                <Input
                  placeholder={t('template.fieldName')}
                  value={field.name}
                  onChange={(e) => {
                    const oldName = field.name;
                    // Update name, which is the unique key in the store
                    const newFields = template.fields.map((f, i) =>
                      i === index ? { ...f, name: e.target.value } : f,
                    );
                    setTemplate({ fields: newFields });
                    void oldName; // keep reference for clarity
                  }}
                  className="sm:w-32"
                />

                {/* Field type */}
                <Select
                  value={field.type}
                  onValueChange={(val) =>
                    updateTemplateField(field.name, {
                      type: val as TemplateField['type'],
                    })
                  }
                >
                  <SelectTrigger className="sm:w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">string</SelectItem>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="boolean">boolean</SelectItem>
                    <SelectItem value="array">array</SelectItem>
                    <SelectItem value="date">date</SelectItem>
                    <SelectItem value="measurement">measurement</SelectItem>
                  </SelectContent>
                </Select>

                {/* Required checkbox */}
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={field.required}
                    onCheckedChange={(checked) =>
                      updateTemplateField(field.name, {
                        required: checked === true,
                      })
                    }
                  />
                  {t('template.required')}
                </label>

                {/* Description */}
                <Input
                  placeholder={t('template.desc')}
                  value={field.description ?? ''}
                  onChange={(e) =>
                    updateTemplateField(field.name, {
                      description: e.target.value || undefined,
                    })
                  }
                  className="flex-1"
                />

                {/* Remove */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeTemplateField(field.name)}
                  aria-label={t('template.removeField', { name: field.name })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          {template.fields.length > 0 && (
            <p className="text-muted-foreground text-xs">
              {t('template.fieldCount', { count: template.fields.length })}
            </p>
          )}
        </div>
      </CardContent>

      {/* Override confirmation dialog */}
      <AlertDialog open={showOverrideDialog} onOpenChange={setShowOverrideDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('template.confirmOverrideTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('template.confirmOverride')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmOverride}>
              {t('template.confirmOverrideAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
