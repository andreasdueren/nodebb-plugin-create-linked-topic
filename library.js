const express = require.main.require('express');
const router = express.Router();
const axios = require('axios');

const plugin = {};

// Directus API configuration
const DIRECTUS_URL = 'https://data.flr.sc';
const DIRECTUS_TOKEN = 'dHlxHjboNFSFr7x4aXb7giXsyKVrZgEs';

// Bot user configuration
let BOT_UID = null;

async function getOrCreateBotUser() {
    if (BOT_UID) return BOT_UID;

    const User = require.main.require('./src/user');
    const db = require.main.require('./src/database');

    // Try to find existing bot user
    const existingUid = await User.getUidByUsername('seed-atlas-bot');

    if (existingUid) {
        BOT_UID = existingUid;
        console.log('Found existing bot user with UID:', BOT_UID);
        return BOT_UID;
    }

    // Create bot user
    try {
        const userData = await User.create({
            username: 'seed-atlas-bot',
            email: 'bot@atlas.growrare.com',
            password: require('crypto').randomBytes(32).toString('hex')
        });

        BOT_UID = userData.uid;

        // Update user profile
        await User.setUserFields(BOT_UID, {
            fullname: 'Seed Atlas Bot',
            signature: 'Automated topics created from the Seed Atlas',
            'icon:text': '🌱',
            'icon:bgColor': '#22c55e'
        });

        console.log('Created bot user with UID:', BOT_UID);
        return BOT_UID;
    } catch (err) {
        console.error('Error creating bot user:', err);
        throw err;
    }
}

plugin.init = async (params) => {
    // Initialize bot user
    try {
        await getOrCreateBotUser();
    } catch (err) {
        console.error('Failed to initialize bot user:', err);
    }
    const { app, router, middleware } = params;

    // Endpoint to find topic by atlas URL and optionally link it to an article ID
    app.get('/api/topic-by-url', async (req, res) => {
        try {
            // Add CORS headers to allow requests from atlas.growrare.com
            res.header('Access-Control-Allow-Origin', 'https://atlas.growrare.com');
            res.header('Access-Control-Allow-Methods', 'GET');
            res.header('Access-Control-Allow-Headers', 'Content-Type');

            const url = req.query.url;
            const articleId = req.query.articleId; // Optional - if provided, create association

            if (!url) {
                return res.json({ error: 'URL parameter required' });
            }

            const db = require.main.require('./src/database');

            // Search through all article associations to find matching URL
            const keys = await db.getSortedSetRange('topics:tid', 0, -1);

            for (const tid of keys) {
                const articleData = await db.getObject(`topic:${tid}:article`);
                if (articleData && articleData.url === url) {
                    // If article ID is provided, create the association so NodeBB blog comments plugin can find it
                    if (articleId) {
                        console.log(`Linking article ${articleId} to existing topic ${tid}`);
                        // Set both storage formats:
                        // 1. Our custom format for tracking
                        await db.setObject(`article:${articleId}`, {
                            tid: tid,
                            url: url,
                            timestamp: Date.now()
                        });
                        // 2. Blog comments plugin format (REQUIRED for plugin to work)
                        await db.setObjectField('blog-comments', articleId, tid);
                        console.log(`Set blog-comments hash: ${articleId} -> ${tid}`);
                    }

                    return res.json({
                        found: true,
                        tid: tid,
                        url: articleData.url
                    });
                }
            }

            res.json({ found: false });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Debug endpoint to check article associations
    app.get('/api/check-article/:articleId', async (req, res) => {
        try {
            const articleId = req.params.articleId;
            const db = require.main.require('./src/database');

            const articleData = await db.getObject(`article:${articleId}`);

            res.json({
                articleId: articleId,
                found: !!articleData,
                data: articleData
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // API endpoint to fetch species data for a topic
    app.get('/api/species-for-topic/:tid', async (req, res) => {
        try {
            const tid = req.params.tid;
            const db = require.main.require('./src/database');

            // Check if this topic is linked to a species
            const articleData = await db.getObject(`topic:${tid}:article`);

            if (!articleData || !articleData.url) {
                return res.json({ error: 'No species linked to this topic' });
            }

            // Extract species slug from URL
            const urlMatch = articleData.url.match(/\/variety\/(.+)$/);
            if (!urlMatch) {
                return res.json({ error: 'Invalid species URL' });
            }

            const slug = urlMatch[1];

            // Fetch species data from Directus API
            const speciesData = await fetchSpeciesData(slug);

            if (!speciesData) {
                return res.json({ error: 'Species not found' });
            }

            // Return species data with atlas URL
            res.json({
                species: speciesData,
                atlasUrl: articleData.url
            });
        } catch (err) {
            console.error('Error fetching species for topic:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // Handle GET requests (for testing or direct access)
    app.get('/create-linked-topic', async (req, res) => {
        // Check if user is logged in
        if (!req.user || !req.user.uid) {
            return res.redirect('/login?local=1&next=/create-linked-topic');
        }

        // Show simple message if accessed directly
        res.send('This endpoint requires POST data. Please use the "Start a Discussion" button on species pages.');
    });

    // Helper function to find or create a subcategory
    async function getOrCreateSubcategory(categoryName, parentCid = 81, uid = 0) {
        if (!categoryName) {
            return parentCid; // Return parent if no category specified
        }

        const Categories = require.main.require('./src/categories');
        const db = require.main.require('./src/database');

        // Check if subcategory already exists under this parent
        const children = await Categories.getChildren([parentCid], uid);
        if (children && children[0]) {
            const existing = children[0].find(child => child.name === categoryName);
            if (existing) {
                console.log(`Found existing subcategory: ${categoryName} (cid: ${existing.cid})`);
                return existing.cid;
            }
        }

        // Create new subcategory
        try {
            const newCategory = await Categories.create({
                name: categoryName,
                description: `Species in the ${categoryName} category`,
                parentCid: parentCid,
                disabled: 0,
                order: 1
            });
            console.log(`Created new subcategory: ${categoryName} (cid: ${newCategory.cid})`);
            return newCategory.cid;
        } catch (err) {
            console.error(`Error creating subcategory ${categoryName}:`, err);
            return parentCid; // Fallback to parent on error
        }
    }

    // Add route to handle topic creation
    app.post('/create-linked-topic', async (req, res) => {
        try {
            const { title, markdown, cid, tags, id, url, slug, category } = req.body;

            console.log('Create linked topic request:', { title, slug, id, url, category });

            // Validate required fields
            if (!title || !id || !url) {
                return res.status(400).send('Missing required fields');
            }

            // Check if user is logged in
            if (!req.user || !req.user.uid) {
                // Redirect to login
                return res.redirect(`/login?local=1&next=/create-linked-topic`);
            }

            // Get or create subcategory if category is provided
            const parentCid = parseInt(cid) || 81;
            const targetCid = category ? await getOrCreateSubcategory(category, parentCid, req.user.uid) : parentCid;
            console.log(`Using category ID: ${targetCid} (parent: ${parentCid}, subcategory: ${category || 'none'})`);

            // Create the topic using NodeBB's internal API
            const Topics = require.main.require('./src/topics');
            const Posts = require.main.require('./src/posts');

            // Get bot user UID
            const botUid = await getOrCreateBotUser();

            const topicData = await Topics.post({
                uid: botUid,
                title: title,
                content: `[View ${title} on Seed Atlas](${url})`,
                cid: targetCid,
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
                // CRITICAL: Set blog-comments hash for NodeBB blog comments plugin to find the topic
                await db.setObjectField('blog-comments', id, tid);
                console.log(`Set blog-comments hash: ${id} -> ${tid}`);

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
                    'fields': 'id,Common_Name,Species,Subspecies,Variety,Cultivar_group,Genus.Genus,Community_Description,SKU,PI_Number,Category.Name,Picture,Community_Gallery.directus_files_id',
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
                    'fields': 'id,Common_Name,Species,Subspecies,Variety,Cultivar_group,Genus.Genus,Community_Description,SKU,PI_Number,Category.Name,Picture,Community_Gallery.directus_files_id',
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

// Hook to replace old species cards with new Bootstrap layout
plugin.replaceSpeciesCard = async (data) => {
    console.log('replaceSpeciesCard hook called, data keys:', Object.keys(data));

    try {
        // Log data structure
        if (data.postData) {
            console.log('postData exists, has content:', !!data.postData.content);
            console.log('postData keys:', Object.keys(data.postData));
            if (data.postData.content) {
                console.log('Content length:', data.postData.content.length);
                console.log('Content preview:', data.postData.content.substring(0, 200));
                console.log('Has gradient?', data.postData.content.includes('linear-gradient'));
            }
        } else {
            console.log('No postData in data object');
        }

        // Check if content has an old species card (look for the old gradient pattern)
        if (!data.postData || !data.postData.content || !data.postData.content.includes('linear-gradient(135deg, #4ade80, #22c55e)')) {
            console.log('No matching content found, returning data unchanged');
            return data;
        }

        const tid = data.postData.tid;
        console.log('Found species card in topic:', tid);
        const db = require.main.require('./src/database');

        // Get article association for this topic
        const articleData = await db.getObject(`topic:${tid}:article`);
        console.log('Article data:', articleData);

        if (!articleData || !articleData.url) {
            console.log('No article data found');
            return data;
        }

        // Extract species slug from URL
        const urlMatch = articleData.url.match(/\/variety\/(.+)$/);
        if (!urlMatch) {
            console.log('URL does not match variety pattern');
            return data;
        }

        const slug = urlMatch[1];
        console.log('Species slug:', slug);

        // Fetch fresh species data
        const speciesData = await fetchSpeciesData(slug);
        console.log('Fetched species data:', speciesData ? 'Success' : 'Failed');

        if (!speciesData) {
            return data;
        }

        // Build new card HTML
        const newCardHtml = buildSpeciesCard(speciesData, articleData.url);
        console.log('Built new card HTML, length:', newCardHtml.length);

        // Replace old card with new card (match any div with the gradient)
        const oldCardPattern = /<div style="background: linear-gradient\(135deg, #4ade80, #22c55e\);[^>]*>[\s\S]*?(?:<\/div>\s*){3,4}/;
        const beforeLength = data.postData.content.length;
        data.postData.content = data.postData.content.replace(oldCardPattern, newCardHtml);
        const afterLength = data.postData.content.length;

        console.log('Replacement result - before:', beforeLength, 'after:', afterLength, 'changed:', beforeLength !== afterLength);
        console.log('Successfully replaced old species card in post', data.postData.pid);
    } catch (err) {
        console.error('Error replacing species card:', err);
        console.error('Stack:', err.stack);
    }

    return data;
};

module.exports = plugin;
