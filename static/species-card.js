// Use NodeBB's ajaxify hooks for client-side navigation
function loadSpeciesCard() {
    // Check if we're on a topic page
    const topicIdMatch = window.location.pathname.match(/^\/topic\/(\d+)/);
    if (!topicIdMatch) return;

    const tid = topicIdMatch[1];
    console.log('Loading species card for topic:', tid);

    // Fetch species data for this topic
    $.get(`/api/species-for-topic/${tid}`, function(data) {
        if (data.error || !data.species) {
            console.log('No species data for this topic');
            return;
        }

        const species = data.species;
        const atlasUrl = data.atlasUrl;

        // Build new species card HTML
        const cardHtml = buildSpeciesCardHTML(species, atlasUrl);

        // Find the first post content
        const firstPost = $('[component="topic"] [component="post/content"]').first();
        if (!firstPost.length) {
            console.log('First post not found, waiting...');
            // Try again after a short delay (posts might still be rendering)
            setTimeout(function() {
                const retryPost = $('[component="topic"] [component="post/content"]').first();
                if (retryPost.length) {
                    insertCard(retryPost, cardHtml);
                }
            }, 500);
            return;
        }

        insertCard(firstPost, cardHtml);
    }).fail(function(err) {
        console.log('Failed to fetch species data:', err);
    });
}

function insertCard(firstPost, cardHtml) {
    // Check if card already exists
    const existingCard = firstPost.parent().find('.card[style*="linear-gradient(135deg, #4ade80, #22c55e)"]');

    if (existingCard.length) {
        console.log('Species card already exists, skipping');
        return;
    }

    // Insert card before the first post content
    console.log('Inserting species card');
    firstPost.before(cardHtml);
}

// Listen for NodeBB's AJAX navigation events
$(window).on('action:ajaxify.end', function(event, data) {
    console.log('Page loaded:', data.url);
    loadSpeciesCard();
});

// Also run on initial page load
$(document).ready(function() {
    console.log('Document ready');
    loadSpeciesCard();
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

    let html = '';
    html += '<div class="card mb-3" style="background: linear-gradient(135deg, #4ade80, #22c55e); border: none; color: #0f172a; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">';
    html += '<div class="row g-0">';

    // Image section (if available) - positioned on the left
    if (imageId) {
        const imageUrl = `https://atlas.growrare.com/image-proxy.php?id=${imageId}&width=500&height=500&fit=cover`;
        html += '<div class="col-md-4 d-flex align-items-center justify-content-center" style="padding: 0; overflow: hidden;">';
        html += `<img src="${imageUrl}" alt="${commonName}" style="width: 100%; height: 100%; object-fit: cover; display: block;">`;
        html += '</div>';
    }

    html += '<div class="col-md-8">';
    html += '<div class="card-body">';
    html += `<h5 class="card-title fw-bold mb-2">${commonName}</h5>`;

    if (scientificName) {
        html += `<p class="card-text mb-2" style="font-size: 1.05rem; opacity: 0.85;">${scientificName}</p>`;
    }

    if (category) {
        html += `<span class="badge rounded-pill mb-2" style="background: rgba(15, 23, 42, 0.15); color: #0f172a; font-weight: 600;">${category}</span>`;
    }

    if (description) {
        const truncatedDesc = description.length > 250 ? description.substring(0, 250) + '...' : description;
        html += `<p class="card-text">${truncatedDesc}</p>`;
    }

    html += `<a href="${atlasUrl}" target="_blank" rel="noopener" class="btn btn-dark">📖 View Full Details on Seed Atlas</a>`;
    html += '</div></div></div></div>';

    return html;
}
