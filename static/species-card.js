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
    const category = species.Category && species.Category.Name ? species.Category.Name : '';

    // Get image ID (prefer Community_Gallery, fallback to Picture)
    let imageId = null;
    if (species.Community_Gallery && Array.isArray(species.Community_Gallery) && species.Community_Gallery.length > 0) {
        imageId = species.Community_Gallery[0].directus_files_id;
    } else if (species.Picture) {
        imageId = species.Picture;
    }

    let html = '<div style="background: linear-gradient(135deg, #4ade80, #22c55e); border-radius: 12px; overflow: hidden; margin-bottom: 20px; color: #0f172a; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">';

    // Image section (if available)
    if (imageId) {
        const imageUrl = `https://atlas.growrare.com/image-proxy.php?id=${imageId}&width=800&height=300&fit=cover`;
        html += `<div style="width: 100%; height: 200px; background-image: url('${imageUrl}'); background-size: cover; background-position: center;"></div>`;
    }

    html += '<div style="padding: 20px;">';
    html += `<h3 style="margin: 0 0 8px 0; font-size: 1.5rem; font-weight: 700;">${commonName}</h3>`;

    if (scientificName) {
        html += `<div style="font-size: 1.05rem; margin-bottom: 12px; opacity: 0.85;">${scientificName}</div>`;
    }

    if (category) {
        html += `<div style="display: inline-block; background: rgba(15, 23, 42, 0.1); padding: 4px 12px; border-radius: 999px; font-size: 0.85rem; font-weight: 600; margin-bottom: 12px;">${category}</div>`;
    }

    if (description) {
        const truncatedDesc = description.length > 250 ? description.substring(0, 250) + '...' : description;
        html += `<div style="font-size: 0.95rem; line-height: 1.6; margin-bottom: 16px; opacity: 0.85;">${truncatedDesc}</div>`;
    }

    html += `<a href="${atlasUrl}" target="_blank" rel="noopener" style="display: inline-block; background: #0f172a; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; transition: background 0.2s;">📖 View Full Details on Seed Atlas →</a>`;
    html += '</div></div>';

    return html;
}
