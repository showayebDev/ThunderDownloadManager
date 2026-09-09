import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(frontendDir, '..');
const outputDir = path.resolve(frontendDir, 'src', 'data');
const outputFile = path.resolve(outputDir, 'openSourceLicenses.json');

// Helper to format repository URLs
function cleanUrl(url) {
  if (!url) return '';
  if (typeof url === 'object' && url.url) {
    url = url.url;
  }
  return String(url)
    .replace(/^git\+/, '')
    .replace(/^ssh:\/\/git@github.com\//, 'https://github.com/')
    .replace(/^git@github.com:/, 'https://github.com/')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

// Helper to extract author display string
function formatAuthor(author, pkgName) {
  if (!author) {
    if (pkgName.includes('react')) return 'Meta Platforms, Inc. and affiliates';
    if (pkgName.includes('tailwind')) return 'Tailwind Labs, Inc.';
    if (pkgName.includes('lucide')) return 'Lucide Contributors & Cole Bemis';
    if (pkgName.includes('wails')) return 'Lea Anthony & Wails Contributors';
    if (pkgName.includes('vite')) return 'Evan You & Vite Contributors';
    if (pkgName.includes('typescript')) return 'Microsoft Corporation';
    if (pkgName.includes('marked')) return 'Christopher Jeffrey and Marked Contributors';
    return 'Open Source Community';
  }
  if (typeof author === 'string') {
    return author.replace(/\s*<.*?>/, '').replace(/\s*\(.*?\)/, '').trim();
  }
  if (typeof author === 'object' && author.name) {
    return String(author.name).trim();
  }
  return 'Open Source Community';
}

// Helper to clean display names
function formatDisplayName(pkgName) {
  const map = {
    'react': 'React',
    'react-dom': 'React DOM',
    'lucide-react': 'Lucide Icons',
    'tailwindcss': 'Tailwind CSS',
    '@tailwindcss/vite': 'Tailwind CSS Vite Plugin',
    'marked': 'Marked',
    '@wailsio/runtime': 'Wails Runtime',
    'vite': 'Vite',
    'typescript': 'TypeScript',
    '@vitejs/plugin-react': 'Vite React Plugin',
  };
  return map[pkgName] || pkgName;
}

// 1. Scan NPM packages from frontend/package.json & node_modules
function scanNpmPackages() {
  const pkgJsonPath = path.resolve(frontendDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return [];

  const mainPkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  const allDeps = {
    ...(mainPkg.dependencies || {}),
    ...(mainPkg.devDependencies || {})
  };

  const results = [];

  for (const depName of Object.keys(allDeps)) {
    // Skip internal type definitions to keep list clean and focused
    if (depName.startsWith('@types/')) continue;

    const depPkgPath = path.resolve(frontendDir, 'node_modules', depName, 'package.json');
    let pkgData = null;

    if (fs.existsSync(depPkgPath)) {
      try {
        pkgData = JSON.parse(fs.readFileSync(depPkgPath, 'utf-8'));
      } catch (err) {
        console.warn(`Could not read package.json for ${depName}:`, err.message);
      }
    }

    const version = pkgData?.version || allDeps[depName].replace(/^[\^~>=<]+/, '');
    const author = formatAuthor(pkgData?.author, depName);
    const license = pkgData?.license || (Array.isArray(pkgData?.licenses) ? pkgData.licenses.map(l => l.type || l).join(', ') : 'MIT');
    const licenseStr = typeof license === 'string' ? (license.includes('License') ? license : `${license} License`) : 'MIT License';
    const repoUrl = cleanUrl(pkgData?.repository || pkgData?.homepage || `https://www.npmjs.com/package/${depName}`);
    const description = pkgData?.description || `${formatDisplayName(depName)} open source library.`;
    const isDev = Boolean(mainPkg.devDependencies && mainPkg.devDependencies[depName]);

    results.push({
      id: depName.replace(/[@/]/g, '-'),
      name: formatDisplayName(depName),
      packageId: depName,
      version: version ? (version.startsWith('v') ? version : `v${version}`) : 'latest',
      author: author,
      license: licenseStr,
      url: repoUrl,
      description: description,
      category: isDev ? 'tooling' : 'frontend'
    });
  }

  return results;
}

// 2. Scan Go backend dependencies from root go.mod
function scanGoPackages() {
  const goModPath = path.resolve(rootDir, 'go.mod');
  const results = [];

  let goVer = '1.25.0';
  const goDeps = [];

  if (fs.existsSync(goModPath)) {
    const content = fs.readFileSync(goModPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('go ')) {
        goVer = trimmed.replace(/^go\s+/, '').trim();
      } else if (trimmed.startsWith('github.com/') || trimmed.startsWith('golang.org/')) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          goDeps.push({ path: parts[0], version: parts[1] });
        }
      }
    }
  }

  // Go standard library / runtime
  results.push({
    id: 'go-runtime',
    name: 'Go Standard Library & Runtime',
    packageId: 'golang.org',
    version: `v${goVer}`,
    author: 'The Go Authors',
    license: 'BSD-3-Clause',
    url: 'https://go.dev',
    description: 'High-performance concurrent programming language runtime and standard libraries.',
    category: 'backend'
  });

  // Known Go dependency metadata mapping
  const knownGoMeta = {
    'github.com/wailsapp/wails/v3': {
      name: 'Wails v3',
      author: 'Lea Anthony & Wails Contributors',
      license: 'MIT License',
      url: 'https://github.com/wailsapp/wails',
      description: 'Framework for building lightweight, high-performance desktop applications with Go backend.'
    },
    'golang.org/x/sys': {
      name: 'golang.org/x/sys',
      author: 'The Go Authors',
      license: 'BSD-3-Clause',
      url: 'https://pkg.go.dev/golang.org/x/sys',
      description: 'Low-level operating system and platform interaction packages for Go.'
    },
    'golang.org/x/image': {
      name: 'golang.org/x/image',
      author: 'The Go Authors',
      license: 'BSD-3-Clause',
      url: 'https://pkg.go.dev/golang.org/x/image',
      description: 'Supplementary image processing, rasterization, and font rendering packages for Go.'
    }
  };

  for (const dep of goDeps) {
    const meta = knownGoMeta[dep.path] || {
      name: dep.path.split('/').pop() || dep.path,
      author: dep.path.startsWith('golang.org') ? 'The Go Authors' : 'Open Source Contributors',
      license: dep.path.startsWith('golang.org') ? 'BSD-3-Clause' : 'MIT License',
      url: dep.path.startsWith('http') ? dep.path : `https://${dep.path}`,
      description: `Go module ${dep.path}.`
    };

    results.push({
      id: dep.path.replace(/[@/.]/g, '-'),
      name: meta.name,
      packageId: dep.path,
      version: dep.version.startsWith('v') ? dep.version : `v${dep.version}`,
      author: meta.author,
      license: meta.license,
      url: meta.url,
      description: meta.description,
      category: 'backend'
    });
  }

  return results;
}

// 3. Core Media Tools
function getCoreMediaTools() {
  return [
    {
      id: 'yt-dlp',
      name: 'yt-dlp',
      packageId: 'yt-dlp/yt-dlp',
      version: 'latest',
      author: 'yt-dlp contributors',
      license: 'The Unlicense',
      url: 'https://github.com/yt-dlp/yt-dlp',
      description: 'A feature-rich command-line audio and video extraction engine used for media downloads.',
      category: 'media'
    },
    {
      id: 'ffmpeg',
      name: 'FFmpeg',
      packageId: 'ffmpeg.org/ffmpeg',
      version: 'latest',
      author: 'FFmpeg Developers',
      license: 'LGPL v2.1+ / GPL v2+',
      url: 'https://ffmpeg.org',
      description: 'Complete cross-platform multimedia solution to decode, encode, mux, and stream video and audio.',
      category: 'media'
    }
  ];
}

function scanAppVersion() {
  // 1. Try src-wails3/commands/version.go
  const versionGoPath = path.resolve(rootDir, 'src-wails3', 'commands', 'version.go');
  if (fs.existsSync(versionGoPath)) {
    const content = fs.readFileSync(versionGoPath, 'utf-8');
    const match = content.match(/AppVersion\s*=\s*["']([^"']+)["']/);
    if (match && match[1]) return match[1].trim();
  }
  // 2. Try build/config.yml
  const configYmlPath = path.resolve(rootDir, 'build', 'config.yml');
  if (fs.existsSync(configYmlPath)) {
    const content = fs.readFileSync(configYmlPath, 'utf-8');
    const match = content.match(/version:\s*["']?([^"'\r\n#]+)/);
    if (match && match[1]) return match[1].trim();
  }
  return '1.0.6';
}

function scanAppLicense() {
  const licensePath = path.resolve(rootDir, 'LICENSE');
  let fullText = '';
  let licenseType = 'MIT License';
  let copyright = 'Copyright (c) 2026 Showayeb Ahamed';
  let author = 'Showayeb Ahamed';
  const version = scanAppVersion();

  if (fs.existsSync(licensePath)) {
    fullText = fs.readFileSync(licensePath, 'utf-8').trim();
    const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      licenseType = lines[0]; // e.g. "MIT License"
    }
    const copyrightLine = lines.find(l => /^copyright/i.test(l));
    if (copyrightLine) {
      copyright = copyrightLine;
      const authorMatch = copyrightLine.match(/copyright\s+(?:\([c-zC-Z0-9©]\)\s+)?(?:\d{4}(?:-\d{4})?\s+)?(.+)/i);
      if (authorMatch && authorMatch[1]) {
        author = authorMatch[1].trim();
      }
    }
  }

  return {
    appName: 'Thunder Download Manager',
    version,
    licenseType,
    copyright,
    author,
    fullText,
    lastUpdated: new Date().toISOString()
  };
}

function main() {
  console.log('[generate-licenses] Scanning dependencies from package.json, node_modules, and go.mod...');

  const mediaTools = getCoreMediaTools();
  const goPackages = scanGoPackages();
  const npmPackages = scanNpmPackages();
  const appLicense = scanAppLicense();

  // Combine and deduplicate by packageId
  const map = new Map();
  for (const pkg of [...mediaTools, ...goPackages, ...npmPackages]) {
    if (!map.has(pkg.packageId)) {
      map.set(pkg.packageId, pkg);
    }
  }

  const allPackages = Array.from(map.values());

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputFile, JSON.stringify(allPackages, null, 2), 'utf-8');
  console.log(`[generate-licenses] Successfully generated ${allPackages.length} open-source licenses to:`);
  console.log(`  -> ${outputFile}`);

  const appLicenseFile = path.resolve(outputDir, 'appLicense.json');
  fs.writeFileSync(appLicenseFile, JSON.stringify(appLicense, null, 2), 'utf-8');
  console.log(`[generate-licenses] Successfully extracted App License from root LICENSE to:`);
  console.log(`  -> ${appLicenseFile}`);
}

main();

