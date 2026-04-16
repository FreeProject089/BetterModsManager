/**
 * betahub-config.example.ts
 * 
 * TEMPLATE for BetaHub configuration.
 * 
 * INSTRUCTIONS:
 * 1. Duplicate this file and rename the copy to 'betahub-config.local.ts'.
 * 2. In your BetaHub project settings (https://app.betahub.io/projects/...), 
 *    find your Project ID (e.g., pr-7482453116).
 * 3. Create or find your API Token in Account Settings -> Personal Access Tokens.
 *    Ensure the token has "can_create_bug_report" and "can_create_feature_request" permissions.
 * 4. Fill in the constants below in your 'betahub-config.local.ts' file.
 * 
 * IMPORTANT: NEVER commit 'betahub-config.local.ts' to git. 
 * The .gitignore has been configured to protect it.
 */

// Your Project Identifier from the BetaHub URL or project settings
export const BETAHUB_PROJECT_ID = 'pr-7482453116';

// Your Personal Access Token (starts with tkn- or Bearer)
export const BETAHUB_TOKEN = 'tkn-5246b26ec2dd19b45d3f26af307282c8192e5bf9fd7b1fd465097fe8ebd01258';
