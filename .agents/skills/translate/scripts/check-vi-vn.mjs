import fs from "node:fs";
import path from "node:path";

const localesDir = path.resolve(process.argv[2] ?? "packages/i18n/src/locales");
const sourceDir = path.join(localesDir, "en");
const targetDir = path.join(localesDir, "vi-VN");

function flatten(value, prefix = "", output = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, next, output);
    else output.set(next, child);
  }
  return output;
}

function tags(message) {
  return [...message.matchAll(/<\/?[A-Za-z][^>]*>|<\/?\d+>/g)].map((match) => match[0]);
}

function messageShape(message, result = { arguments: [], controls: [] }) {
  for (let index = 0; index < message.length; index += 1) {
    if (message[index] !== "{") continue;

    let cursor = index + 1;
    while (/\s/.test(message[cursor] ?? "")) cursor += 1;
    const nameMatch = message.slice(cursor).match(/^([A-Za-z_][\w.]*)/);
    if (!nameMatch) continue;

    const name = nameMatch[1];
    cursor += name.length;
    while (/\s/.test(message[cursor] ?? "")) cursor += 1;
    result.arguments.push(name);

    if (message[cursor] === "}") {
      index = cursor;
      continue;
    }
    if (message[cursor] !== ",") continue;

    cursor += 1;
    while (/\s/.test(message[cursor] ?? "")) cursor += 1;
    const typeMatch = message.slice(cursor).match(/^(plural|selectordinal|select)/);
    if (!typeMatch) continue;

    const type = typeMatch[1];
    cursor += type.length;
    while (/\s/.test(message[cursor] ?? "")) cursor += 1;
    if (message[cursor] === ",") cursor += 1;

    const selectors = [];
    while (cursor < message.length) {
      while (/\s/.test(message[cursor] ?? "")) cursor += 1;
      if (message[cursor] === "}") break;

      const selectorMatch = message.slice(cursor).match(/^(?:offset:\d+|=?[\w-]+)/);
      if (!selectorMatch) break;
      const selector = selectorMatch[0];
      cursor += selector.length;
      if (!selector.startsWith("offset:")) selectors.push(selector);
      while (/\s/.test(message[cursor] ?? "")) cursor += 1;
      if (message[cursor] !== "{") break;

      let depth = 1;
      const bodyStart = cursor + 1;
      cursor += 1;
      while (cursor < message.length && depth > 0) {
        if (message[cursor] === "{") depth += 1;
        else if (message[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      messageShape(message.slice(bodyStart, cursor - 1), result);
    }

    result.controls.push(`${name}:${type}:${selectors.sort().join(",")}`);
    index = cursor;
  }
  result.arguments.sort();
  result.controls.sort();
  return result;
}

const expectedTerms = new Map(Object.entries({
  "common.json:common.module": "Nhóm công việc",
  "navigation.json:sidebar.modules": "Nhóm công việc",
  "common.json:common.parent": "Mục mẹ",
  "work-item.json:issue.add.parent": "Thêm mục công việc mẹ",
  "common.json:common.cycle": "Chu kỳ",
  "navigation.json:sidebar.views": "Bộ lọc đã lưu",
  "settings.json:account_settings.notifications.select_default_view": "Chọn cách hiển thị mặc định",
  "home.json:home.manage_widgets": "Quản lý thẻ thông tin",
  "common.json:active_cycles": "Active Cycles"
}));

const files = fs.readdirSync(sourceDir).filter((file) => file.endsWith(".json")).sort();
const targetFiles = fs.readdirSync(targetDir).filter((file) => file.endsWith(".json")).sort();
const failures = [];
let valueCount = 0;

if (JSON.stringify(files) !== JSON.stringify(targetFiles)) failures.push("Locale file set differs from English.");

for (const file of files) {
  const source = flatten(JSON.parse(fs.readFileSync(path.join(sourceDir, file), "utf8")));
  const target = flatten(JSON.parse(fs.readFileSync(path.join(targetDir, file), "utf8")));
  valueCount += target.size;

  for (const key of source.keys()) if (!target.has(key)) failures.push(`${file}:${key}: missing key`);
  for (const key of target.keys()) if (!source.has(key)) failures.push(`${file}:${key}: stale key`);

  for (const [key, sourceValue] of source) {
    const targetValue = target.get(key);
    if (typeof sourceValue !== "string" || typeof targetValue !== "string") continue;
    const location = `${file}:${key}`;

    if ((sourceValue.match(/\n/g) ?? []).length !== (targetValue.match(/\n/g) ?? []).length)
      failures.push(`${location}: line-break count changed`);
    if (JSON.stringify(tags(sourceValue)) !== JSON.stringify(tags(targetValue)))
      failures.push(`${location}: tag structure changed`);
    if (JSON.stringify(messageShape(sourceValue)) !== JSON.stringify(messageShape(targetValue)))
      failures.push(`${location}: ICU or interpolation structure changed`);
    if (targetValue.includes("—")) failures.push(`${location}: em dash is not Vietnamese product style`);

    if (/modules?/i.test(sourceValue) && /mô-đun|dự án con/i.test(targetValue))
      failures.push(`${location}: deprecated Module translation`);
    if (/parent/i.test(sourceValue) && /\bcha\b|cha-con/i.test(targetValue))
      failures.push(`${location}: deprecated parent translation`);
    if (/widgets?/i.test(sourceValue) && /tiện ích/i.test(targetValue))
      failures.push(`${location}: deprecated Widget translation`);
    if (/\bviews?\b/i.test(sourceValue) && /chế độ xem/i.test(targetValue))
      failures.push(`${location}: translate View by purpose`);
  }

  for (const [location, expected] of expectedTerms) {
    const [expectedFile, ...keyParts] = location.split(":");
    if (expectedFile !== file) continue;
    const actual = target.get(keyParts.join(":"));
    if (actual !== expected) failures.push(`${location}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`vi-VN locale check passed: ${files.length} files, ${valueCount} values.`);
