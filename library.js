const express = require.main.require('express');
const router = express.Router();

const plugin = {};

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

module.exports = plugin;
