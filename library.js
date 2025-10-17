const express = require.main.require('express');
const router = express.Router();
const axios = require('axios');

const plugin = {};

// Directus API configuration
const DIRECTUS_URL = 'https://data.flr.sc';
const DIRECTUS_TOKEN = 'dHlxHjboNFSFr7x4aXb7giXsyKVrZgEs';

plugin.init = async (params) => {
    const { app } = params;

    // Handle GET requests (for testing or direct access)
    app.get('/create-linked-topic', async (req, res) => {
        // Check if user is logged in
        if (!req.user || !req.user.uid) {
            return res.redirect('/login?local=1&next=/create-linked-topic');
        }

        // Show simple message if accessed directly
        res.send('This endpoint requires POST data. Please use the "Start a Discussion" button on species pages.');
    });

    // Add route to handle topic creation
    app.post('/create-linked-topic', async (req, res) => {
        try {
            const { title, markdown, cid, tags, id, url, slug } = req.body;

            console.log('Create linked topic request:', { title, slug, id, url });

            // Validate required fields
            if (!title || !id || !url) {
                return res.status(400).send('Missing required fields');
            }

            // Check if user is logged in
            if (!req.user || !req.user.uid) {
                // Redirect to login
                return res.redirect(`/login?local=1&next=/create-linked-topic`);
            }

            // Create the topic using NodeBB's internal API
            const Topics = require.main.require('./src/topics');
            const Posts = require.main.require('./src/posts');

            const topicData = await Topics.post({
                uid: req.user.uid,
                title: title,
                content: markdown || `Discussion about ${title}\n\n[View on Seed Atlas](${url})`,
                cid: parseInt(cid) || 81,
                tags: tags ? JSON.parse(tags) : [],
                timestamp: Date.now()
            });

            // Associate with article ID using blog comments plugin metadata
            if (topicData && topicData.topicData) {
                const tid = topicData.topicData.tid;

                // Set custom slug to match atlas page
                if (slug) {
                    const customSlug = `${tid}/${slug}`;
                    console.log(`Setting custom slug for topic ${tid}: ${customSlug}`);
                    await Topics.setTopicField(tid, 'slug', customSlug);
                    console.log('Slug set successfully');
                } else {
                    console.log('No slug provided from atlas page');
                }

                // Store article association
                const db = require.main.require('./src/database');
                await db.setObject(`article:${id}`, {
                    tid: tid,
                    url: url,
                    timestamp: Date.now()
                });
                await db.setObject(`topic:${tid}:article`, {
                    id: id,
                    url: url
                });

                // Redirect to the new topic
                return res.redirect(`/topic/${tid}`);
            }

            res.status(500).send('Failed to create topic');
        } catch (err) {
            console.error('Error creating linked topic:', err);
            res.status(500).send('Error: ' + err.message);
        }
    });
};

// Inject species data card into topic pages
plugin.addSpeciesCard = async (data) => {
    const tid = data.tid;
    console.log('addSpeciesCard called for topic:', tid);

    try {
        const db = require.main.require('./src/database');

        // Check if this topic is linked to a species
        const articleData = await db.getObject(`topic:${tid}:article`);
        console.log('Article data for topic', tid, ':', articleData);

        if (!articleData || !articleData.url) {
            return data;
        }

        // Extract species slug from URL
        const urlMatch = articleData.url.match(/\/variety\/(.+)$/);
        if (!urlMatch) {
            return data;
        }

        const slug = urlMatch[1];

        // Fetch species data from Directus API
        const speciesData = await fetchSpeciesData(slug);
        console.log('Fetched species data:', speciesData ? 'Success' : 'Failed');

        if (speciesData) {
            // Build the species card HTML
            const cardHtml = buildSpeciesCard(speciesData, articleData.url);
            console.log('Built card HTML (first 200 chars):', cardHtml.substring(0, 200));

            // Inject the card at the beginning of the topic content
            if (data.posts && data.posts.length > 0) {
                console.log('Injecting card into first post');
                data.posts[0].content = cardHtml + data.posts[0].content;
            } else {
                console.log('No posts found in data');
            }
        }
    } catch (err) {
        console.error('Error adding species card:', err);
    }

    return data;
};

async function fetchSpeciesData(slug) {
    try {
        // Parse slug to extract SKU if present (e.g., "brandywine-BR10" -> SKU is "BR10")
        const parts = slug.split('-');
        let sku = null;

        // Check if last part could be a SKU (uppercase letters/numbers)
        if (parts.length > 1) {
            const lastPart = parts[parts.length - 1];
            if (/^[A-Z0-9]+$/.test(lastPart)) {
                sku = lastPart;
            }
        }

        let speciesItem = null;

        // Try fetching by SKU first
        if (sku) {
            const response = await axios.get(`${DIRECTUS_URL}/items/Species`, {
                params: {
                    'filter[SKU][_eq]': sku,
                    'fields': 'id,Common_Name,Species,Subspecies,Variety,Cultivar_group,Genus.Genus,Community_Description,SKU,PI_Number',
                    'limit': 1
                },
                headers: {
                    'Authorization': `Bearer ${DIRECTUS_TOKEN}`
                }
            });

            if (response.data && response.data.data && response.data.data.length > 0) {
                speciesItem = response.data.data[0];
            }
        }

        // If no SKU match, try searching by name
        if (!speciesItem) {
            const searchQuery = parts.join(' ');
            const response = await axios.get(`${DIRECTUS_URL}/items/Species`, {
                params: {
                    'search': searchQuery,
                    'fields': 'id,Common_Name,Species,Subspecies,Variety,Cultivar_group,Genus.Genus,Community_Description,SKU,PI_Number',
                    'limit': 1
                },
                headers: {
                    'Authorization': `Bearer ${DIRECTUS_TOKEN}`
                }
            });

            if (response.data && response.data.data && response.data.data.length > 0) {
                speciesItem = response.data.data[0];
            }
        }

        return speciesItem;
    } catch (err) {
        console.error('Error fetching species from Directus:', err.message);
        return null;
    }
}

function buildSpeciesCard(species, atlasUrl) {
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

    const scientificName = scientificParts.length > 0 ? scientificParts.join(' ') : '';

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
        html += `<div style="font-size: 0.95rem; line-height: 1.6; margin-bottom: 12px; opacity: 0.9;">${description.substring(0, 300)}${description.length > 300 ? '...' : ''}</div>`;
    }

    if (identifiers.length > 0) {
        html += `<div style="font-size: 0.85rem; opacity: 0.8; margin-bottom: 12px;">${identifiers.join(' • ')}</div>`;
    }

    html += `<a href="${atlasUrl}" target="_blank" rel="noopener" style="display: inline-block; background: rgba(255,255,255,0.2); color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 500; transition: background 0.2s; backdrop-filter: blur(10px);">📖 View Full Details on Seed Atlas →</a>`;
    html += '</div>';

    return html;
}

module.exports = plugin;
