export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ 
            message: 'Method not allowed',
            error: true
        });
    }

    const { playerTag } = req.query;
    const playerTagValue = Array.isArray(playerTag) ? playerTag[0] : playerTag;

    // Validate player tag
    if (!playerTagValue || typeof playerTagValue !== 'string') {
        return res.status(400).json({
            message: 'Player tag is required',
            error: true
        });
    }

    // Get API key from environment variable
    const apiKey = process.env.COC_API_KEY;
    
    if (!apiKey) {
        console.error('COC_API_KEY environment variable is not set');
        return res.status(500).json({
            message: 'Server configuration error: API key not configured',
            error: true
        });
    }

    try {
        // Normalize and validate player tag before calling upstream API.
        // Allowed characters follow Supercell tags: # + [0289PYLQGRJCUV]
        let normalizedTag;
        try {
            normalizedTag = decodeURIComponent(playerTagValue).trim().toUpperCase();
        } catch {
            return res.status(400).json({
                message: 'Invalid player tag format',
                error: true
            });
        }

        const rawTag = normalizedTag.startsWith('#') ? normalizedTag.slice(1) : normalizedTag;

        if (!/^[0289PYLQGRJCUV]+$/.test(rawTag)) {
            return res.status(400).json({
                message: 'Invalid player tag format',
                error: true
            });
        }

        const formattedTag = `%23${rawTag}`;
        
        console.log(`Fetching data for player tag: ${formattedTag}`);
        
        const requestOptions = {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };

        // AbortSignal.timeout is unavailable on some Node runtimes.
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            requestOptions.signal = AbortSignal.timeout(10000);
        }

        const response = await fetch(
            `https://api.clashofclans.com/v1/players/${formattedTag}`,
            requestOptions
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error(`API Error ${response.status}:`, errorData);
            
            const errorReason = errorData.reason || 'Unknown error';

            let errorMessage = 'Failed to fetch player data';
            if (response.status === 403) {
                if (errorReason === 'accessDenied.invalidIp') {
                    errorMessage = 'API key IP is not whitelisted for Clash of Clans API';
                } else if (errorReason === 'accessDenied') {
                    errorMessage = 'API access denied. Check your Clash API key permissions';
                } else {
                    errorMessage = 'Invalid API key or access denied';
                }
            }
            if (response.status === 404) errorMessage = 'Player not found';
            if (response.status === 429) errorMessage = 'Too many requests, please try again later';
            if (response.status === 503) errorMessage = 'Service temporarily unavailable';
            
            return res.status(response.status).json({
                message: errorMessage,
                error: true,
                status: response.status,
                details: errorReason
            });
        }

        const data = await response.json();
        console.log(`Successfully fetched data for: ${data.name} (${data.tag})`);
        
        // Return successful response
        return res.status(200).json({
            data: data,
            success: true,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Clash of Clans API Error:', error);
        
        let errorMessage = 'Internal server error';
        if (error.name === 'AbortError') errorMessage = 'Request timeout';
        if (error.name === 'TypeError') errorMessage = 'Network error';
        
        return res.status(500).json({
            message: errorMessage,
            error: true,
            details: error.message
        });
    }
}
