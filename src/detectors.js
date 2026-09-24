const priorities = {
  SECRET: 90, JWT: 80, CN_ID: 70, CARD: 65, STUDENT_ID: 60, ACCOUNT_ID: 60,
  PHONE: 55, EMAIL: 50, ADDRESS: 45, NAME: 40, BIRTH_DATE: 35,
  PERSONAL: 30, ACADEMIC: 20, IP: 15, CUSTOM: 10
};

const formatPatterns = [
  {
    type: "中国大陆手机号", label: "PHONE",
    regex: /(?<!\d)(?:\+?86[ -]?)?1[3-9](?:[ -]?\d){9}(?!\d)/g,
    validate: (value) => /^1[3-9]\d{9}$/.test(value.replace(/^\+?86[ -]?/, "").replace(/[ -]/g, ""))
  },
  {
    type: "身份证号", label: "CN_ID",
    regex: /(?<!\d)\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
    validate: validChineseId
  },
  { type: "电子邮箱", label: "EMAIL", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: "IPv4 地址", label: "IP", regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { type: "银行卡号", label: "CARD", regex: /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g, validate: luhnValid },
  { type: "JWT", label: "JWT", regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { type: "API 密钥", label: "SECRET", regex: /\b(?:sk|pk|ghp|github_pat|xox[baprs]|AIza)[-_A-Za-z0-9]{12,}\b/g },
  { type: "AWS Access Key", label: "SECRET", regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { type: "私钥", label: "SECRET", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g }
];

const baseContextFields = [
  { type: "学号", label: "STUDENT_ID", source: "学生编号|学籍号|准考证号|考生号|学[号叶]|student\\s*(?:id|no\\.?|number)", validate: idValue },
  { type: "姓名", label: "NAME", source: "学生姓名|姓名|name", validate: nameValue },
  { type: "身份证号", label: "CN_ID", source: "身份证号码|身份证号|证件号码|证件号", validate: looseIdentifier },
  { type: "电话号码", label: "PHONE", source: "联系电话|联系方式|手机号码|手机号|电话", validate: loosePhone },
  { type: "电子邮箱", label: "EMAIL", source: "电子邮箱|邮箱|e-?mail", validate: looseEmail },
  { type: "地址", label: "ADDRESS", source: "家庭住址|联系地址|通讯地址|住址|地址|address", validate: longValue },
  { type: "账号或工号", label: "ACCOUNT_ID", source: "员工编号|用户编号|客户编号|工号|账号|用户\\s*id|employee\\s*id", validate: idValue },
  { type: "出生日期", label: "BIRTH_DATE", source: "出生日期|出生年月|生日|date\\s*of\\s*birth|dob", validate: shortValue },
  { type: "性别", label: "PERSONAL", source: "性别|gender|sex", validate: shortValue },
  { type: "学籍信息", label: "ACADEMIC", source: "所在学院|学院|院系|专业|班级|college|department|major|class", validate: mediumValue }
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contextFields(customKeywords = []) {
  const custom = customKeywords
    .map((item) => item.trim())
    .filter(Boolean)
    .map((keyword) => ({ type: `自定义字段：${keyword}`, label: "CUSTOM", source: escapeRegExp(keyword), validate: mediumValue }));
  return [...baseContextFields, ...custom];
}

function compact(value) { return value.replace(/\s/g, ""); }
function idValue(value) { const clean = compact(value); return /^(?=[A-Z0-9_-]*\d)[A-Z0-9][A-Z0-9_-]{4,23}$/i.test(clean); }
function nameValue(value) { const clean = value.trim(); return /^[\p{Script=Han}·]{2,8}$/u.test(clean) || /^[A-Za-z][A-Za-z .'-]{1,39}$/.test(clean); }
function looseIdentifier(value) { const clean = compact(value); return /^(?=.*\d)[A-Z0-9_-]{6,24}$/i.test(clean); }
function loosePhone(value) { const clean = value.replace(/[\s()+-]/g, ""); return /^\d{5,16}$/.test(clean); }
function looseEmail(value) { const clean = value.trim(); return clean.length >= 3 && clean.length <= 64 && !/[＊*•]/.test(clean); }
function shortValue(value) { const size = value.trim().length; return size >= 1 && size <= 64; }
function mediumValue(value) { const size = value.trim().length; return size >= 2 && size <= 48; }
function longValue(value) { const size = value.trim().length; return size >= 4 && size <= 96; }

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validChineseId(value) {
  const id = value.toUpperCase();
  if (!validDate(Number(id.slice(6, 10)), Number(id.slice(10, 12)), Number(id.slice(12, 14)))) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = "10X98765432";
  const sum = weights.reduce((total, weight, index) => total + Number(id[index]) * weight, 0);
  return checks[sum % 11] === id[17];
}

function luhnValid(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 16 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function removeOverlaps(findings) {
  const ranked = [...findings].sort((a, b) => a.start - b.start || b.end - a.end || (priorities[b.label] || 0) - (priorities[a.label] || 0));
  const accepted = [];
  for (const candidate of ranked) {
    const overlapIndex = accepted.findIndex((item) => candidate.start < item.end && candidate.end > item.start);
    if (overlapIndex < 0) { accepted.push(candidate); continue; }
    const existing = accepted[overlapIndex];
    if ((priorities[candidate.label] || 0) > (priorities[existing.label] || 0)) accepted[overlapIndex] = candidate;
  }
  return accepted.sort((a, b) => a.start - b.start || b.end - a.end);
}

function contextualTextFindings(text, customKeywords) {
  const findings = [];
  let lineOffset = 0;
  for (const line of text.split(/\n/)) {
    const labels = [];
    for (const field of contextFields(customKeywords)) {
      for (const match of line.matchAll(new RegExp(field.source, "gi"))) {
        const start = match.index;
        const end = match.index + match[0].length;
        const before = line[start - 1];
        const after = line[end];
        const validBefore = start === 0 || /[\s，,；;|]/.test(before);
        const validAfter = end === line.length || /[\s:：#=\-—]/.test(after);
        if (validBefore && validAfter) labels.push({ field, start, end });
      }
    }
    labels.sort((a, b) => a.start - b.start || b.end - a.end);
    labels.forEach((label, index) => {
      const nextStart = labels[index + 1]?.start ?? line.length;
      const segment = line.slice(label.end, nextStart);
      const prefixLength = segment.match(/^[\s:：#=\-—]*/)?.[0].length || 0;
      const remainder = segment.slice(prefixLength);
      const rawValue = remainder.split(/[，,；;|]/, 1)[0].trimEnd();
      if (!rawValue || !label.field.validate(rawValue)) return;
      const start = lineOffset + label.end + prefixLength;
      findings.push({ type: label.field.type, label: label.field.label, value: rawValue, start, end: start + rawValue.length, contextual: true });
    });
    lineOffset += line.length + 1;
  }
  return findings;
}

export function detectSensitiveText(text, options = {}) {
  const findings = [];
  for (const pattern of formatPatterns) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      if (pattern.validate && !pattern.validate(match[0])) continue;
      findings.push({ type: pattern.type, label: pattern.label, value: match[0], start: match.index, end: match.index + match[0].length });
    }
  }
  findings.push(...contextualTextFindings(text, options.customKeywords || []));
  return removeOverlaps(findings);
}

export function redactText(text, findings) {
  const merged = [];
  for (const item of [...findings].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = merged.at(-1);
    if (last && item.start < last.end) { if (item.end > last.end) last.end = item.end; continue; }
    merged.push({ ...item });
  }
  let result = "";
  let cursor = 0;
  for (const item of merged) { result += text.slice(cursor, item.start); result += `[${item.label}]`; cursor = item.end; }
  return result + text.slice(cursor);
}

function lineCandidates(lineWords, separator, options) {
  let cursor = 0;
  const ranges = lineWords.map((word, index) => {
    const start = cursor;
    const end = start + word.text.length;
    cursor = end + (index === lineWords.length - 1 ? 0 : separator.length);
    return { word, start, end };
  });
  return detectSensitiveText(lineWords.map((word) => word.text).join(separator), options).map((finding) => ({ finding, ranges }));
}

function regionFromWords(finding, matchedWords) {
  return {
    ...finding,
    x0: Math.min(...matchedWords.map((word) => word.bbox.x0)), y0: Math.min(...matchedWords.map((word) => word.bbox.y0)),
    x1: Math.max(...matchedWords.map((word) => word.bbox.x1)), y1: Math.max(...matchedWords.map((word) => word.bbox.y1)),
    confidence: Math.round(matchedWords.reduce((sum, word) => sum + (word.confidence || 0), 0) / matchedWords.length)
  };
}

function keywordOccurrences(lineWords, fields) {
  let cursor = 0;
  const ranges = lineWords.map((word) => { const start = cursor; const end = start + word.text.length; cursor = end; return { word, start, end }; });
  const text = lineWords.map((word) => word.text).join("");
  const found = [];
  for (const field of fields) {
    for (const match of text.matchAll(new RegExp(field.source, "gi"))) {
      const matchEnd = match.index + match[0].length;
      const startRange = ranges.find((range) => range.start <= match.index && range.end > match.index);
      const endRange = ranges.find((range) => range.start < matchEnd && range.end >= matchEnd);
      const startsAtWord = startRange?.start === match.index;
      const trailing = endRange ? text.slice(matchEnd, endRange.end) : "";
      const endsAtWordOrPunctuation = endRange && (endRange.end === matchEnd || /^[:：#=\-—]+$/.test(trailing));
      if (!startsAtWord || !endsAtWordOrPunctuation) continue;
      const words = ranges.filter((range) => range.end > match.index && range.start < matchEnd).map((range) => range.word);
      if (words.length) found.push({ field, words });
    }
  }
  return found;
}

function candidateGroups(lineWords, minX = -Infinity) {
  const eligible = lineWords.filter((word) => word.bbox.x0 >= minX && !/^[:：#=\-—]$/.test(word.text));
  return [...eligible.map((word) => ({ value: word.text, words: [word] })), ...(eligible.length ? [{ value: eligible.map((word) => word.text).join(""), words: eligible }] : [])];
}

function layoutContextRegions(lineGroups, existingRegions, options) {
  const fields = contextFields(options.customKeywords || []);
  const sortedLines = [...lineGroups].sort((a, b) => Math.min(...a.map((word) => word.bbox.y0)) - Math.min(...b.map((word) => word.bbox.y0)));
  const additions = [];
  sortedLines.forEach((labelLine, lineIndex) => {
    for (const occurrence of keywordOccurrences(labelLine, fields)) {
      const labelBox = regionFromWords({}, occurrence.words);
      const alreadyFound = [...existingRegions, ...additions].some((region) =>
        region.label === occurrence.field.label && region.y0 <= labelBox.y1 + Math.max(30, labelBox.y1 - labelBox.y0)
      );
      if (alreadyFound) continue;
      const sameLine = candidateGroups(labelLine, labelBox.x1 - 1);
      const below = sortedLines.slice(lineIndex + 1, lineIndex + 3).flatMap((line) => candidateGroups(line));
      const ranked = [...sameLine, ...below]
        .filter((candidate) => occurrence.field.validate(candidate.value))
        .map((candidate) => {
          const box = regionFromWords({}, candidate.words);
          const dx = Math.max(0, box.x0 - labelBox.x1);
          const dy = Math.max(0, box.y0 - labelBox.y1);
          return { ...candidate, box, distance: dx + dy * 2 };
        })
        .filter((candidate) => candidate.box.y0 <= labelBox.y1 + Math.max(140, (labelBox.y1 - labelBox.y0) * 5))
        .sort((a, b) => a.distance - b.distance || b.value.length - a.value.length);
      if (!ranked[0]) continue;
      additions.push(regionFromWords({ type: occurrence.field.type, label: occurrence.field.label, value: ranked[0].value, start: 0, end: ranked[0].value.length, contextual: true }, ranked[0].words));
    }
  });
  return additions;
}

export function detectOcrWords(words, options = {}) {
  const lines = new Map();
  for (const word of words || []) {
    const key = `${word.block_num ?? 0}:${word.par_num ?? 0}:${word.line_num ?? 0}`;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(word);
  }
  const regions = [];
  for (const lineWords of lines.values()) {
    for (const { finding, ranges } of [...lineCandidates(lineWords, " ", options), ...lineCandidates(lineWords, "", options)]) {
      const matchedWords = ranges.filter((range) => range.end > finding.start && range.start < finding.end).map((range) => range.word);
      if (!matchedWords.length) continue;
      const region = regionFromWords(finding, matchedWords);
      const duplicate = regions.some((item) => item.label === region.label && item.x0 === region.x0 && item.y0 === region.y0 && item.x1 === region.x1 && item.y1 === region.y1);
      if (!duplicate) regions.push(region);
    }
  }
  regions.push(...layoutContextRegions(lines.values(), regions, options));
  return regions;
}
