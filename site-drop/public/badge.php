<?php
declare(strict_types=1);

/**
 * /badge.svg via the rewrite in badge.htaccess.snippet.
 * Cached 10 minutes. Reads supporters.json. Never invents a count.
 */

function extropy_badge_count(string $supportersPath): ?int
{
    if (!is_file($supportersPath)) {
        return null;
    }
    $decoded = json_decode((string) file_get_contents($supportersPath), true);
    if (!is_array($decoded) || !array_key_exists('count', $decoded) || !is_int($decoded['count']) || $decoded['count'] < 0) {
        return null;
    }
    return $decoded['count'];
}

function extropy_badge_text(?int $count): string
{
    $label = $count === null ? 'not counted yet' : (string) $count;
    return 'Runs the Extropy Engine · supporters ' . $label . ' of 10,000 · start your own pocket';
}

function extropy_badge_svg(?int $count): string
{
    $text = extropy_badge_text($count);
    $safe = htmlspecialchars($text, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $width = 860;
    return <<<SVG
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{$width}" height="36" viewBox="0 0 {$width} 36" role="img" aria-label="{$safe}">
  <title>{$safe}</title>
  <a href="https://extropyengine.com/dollar">
    <rect width="{$width}" height="36" rx="6" fill="#14120b"/>
    <text x="14" y="23" fill="#f4efe4" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14">{$safe}</text>
  </a>
</svg>
SVG;
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    $path = getenv('EXTROPY_SUPPORTERS_PATH');
    if (!is_string($path) || $path === '') {
        $path = __DIR__ . '/supporters.json';
    }
    header('Content-Type: image/svg+xml; charset=utf-8');
    header('Cache-Control: public, max-age=600');
    echo extropy_badge_svg(extropy_badge_count($path));
}
