$(document).ready(function() {
    // Check if we're on a topic page
    const topicIdMatch = window.location.pathname.match(/^\/topic\/(\d+)/);
    if (!topicIdMatch) return;

    const tid = topicIdMatch[1];

    // Fetch species data for this topic
    $.get(`/api/species-for-topic/${tid}`, function(data) {
        if (data.error || !data.species) return;

        const species = data.species;
        const atlasUrl = data.atlasUrl;

        // Build species card HTML
        const cardHtml = buildSpeciesCardHTML(species, atlasUrl);

        // Insert card before the first post
        const firstPost = $('[component="topic"] [component="post/content"]').first();
        if (firstPost.length) {
            firstPost.before(cardHtml);
        }
    });
});

function buildSpeciesCardHTML(species, atlasUrl) {
    const commonName = species.Common_Name || 'Unknown Species';

    // Build scientific name
    const scientificParts = [];
    if (species.Genus && species.Genus.Genus) {
        scientificParts.push(`<em>${species.Genus.Genus}</em>`);
    }
    if (species.Species) {
        scientificParts.push(`<em>${species.Species}</em>`);
    }
    if (species.Subspecies) {
        scientificParts.push(`subsp. <em>${species.Subspecies}</em>`);
    }
    if (species.Variety) {
        scientificParts.push(`var. <em>${species.Variety}</em>`);
    }
    if (species.Cultivar_group) {
        scientificParts.push(`'${species.Cultivar_group}'`);
    }

    const scientificName = scientificParts.join(' ');
    const description = species.Community_Description || '';

    // Build identifiers
    const identifiers = [];
    if (species.SKU) identifiers.push(`SKU: ${species.SKU}`);
    if (species.PI_Number) identifiers.push(`PI: ${species.PI_Number}`);

    let html = '<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 20px; margin-bottom: 20px; color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">';
    html += '<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">';
    html += '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M12 9v13"></path><path d="M9 15l-2 2"></path><path d="M15 15l2 2"></path></svg>';
    html += `<h3 style="margin: 0; font-size: 1.4rem; font-weight: 600;">${commonName}</h3>`;
    html += '</div>';

    if (scientificName) {
        html += `<div style="font-size: 1.1rem; margin-bottom: 12px; opacity: 0.95;">${scientificName}</div>`;
    }

    if (description) {
        const truncatedDesc = description.length > 300 ? description.substring(0, 300) + '...' : description;
        html += `<div style="font-size: 0.95rem; line-height: 1.6; margin-bottom: 12px; opacity: 0.9;">${truncatedDesc}</div>`;
    }

    if (identifiers.length > 0) {
        html += `<div style="font-size: 0.85rem; opacity: 0.8; margin-bottom: 12px;">${identifiers.join(' • ')}</div>`;
    }

    html += `<a href="${atlasUrl}" target="_blank" rel="noopener" style="display: inline-block; background: rgba(255,255,255,0.2); color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 500; transition: background 0.2s; backdrop-filter: blur(10px);">📖 View Full Details on Seed Atlas →</a>`;
    html += '</div>';

    return html;
}
