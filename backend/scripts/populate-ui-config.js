#!/usr/bin/env node

/**
 * Populate ui_config collection in MongoDB
 *
 * This script seeds the UI configuration values for dropdowns,
 * validation rules, and other frontend settings.
 *
 * Usage:
 *   node scripts/populate-ui-config.js
 */

const mongodb = require('../src/mongodb');

const { defaultUIConfig } = require('../src/data/ui-config-defaults');

async function populateUIConfig() {
  try {
    console.log('Connecting to MongoDB...');
    await mongodb.connect();

    const db = mongodb.getDb();
    const collection = db.collection('ui_config');

    console.log('Upserting UI configuration...');

    // Upsert (insert or update) the default config
    const result = await collection.replaceOne(
      { _id: 'default' },
      defaultUIConfig,
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      console.log('✅ UI configuration created successfully');
    } else if (result.modifiedCount > 0) {
      console.log('✅ UI configuration updated successfully');
    } else {
      console.log('✅ UI configuration already up to date');
    }

    // Create index on version for future versioning support
    await collection.createIndex({ version: 1 });
    console.log('✅ Indexes created');

    // Display configuration summary
    console.log('\n📋 Configuration Summary:');
    console.log(`   HTTP Methods: ${defaultUIConfig.httpMethods.length}`);
    console.log(`   Auth Types: ${defaultUIConfig.authTypes.length} (includes OAUTH1, OAUTH2, CUSTOM_HEADERS)`);
    console.log(`   Scope Types: ${defaultUIConfig.scopeTypes.length}`);
    console.log(`   Delivery Statuses: ${defaultUIConfig.deliveryStatuses.length}`);
    console.log(`   Transformation Modes: ${defaultUIConfig.transformationModes.length}`);
    console.log(`   Transformation Functions: ${defaultUIConfig.transformationFunctions.length}`);
    console.log(`   Timeout Range: ${defaultUIConfig.validationRules.timeout.min}-${defaultUIConfig.validationRules.timeout.max} ms`);
    console.log(`   Retry Range: ${defaultUIConfig.validationRules.retry.min}-${defaultUIConfig.validationRules.retry.max}`);
    console.log(`   Max Integrations Per Entity: ${defaultUIConfig.limits.maxIntegrationsPerEntity}`);
    console.log(`   Max Actions Per Integration: ${defaultUIConfig.limits.maxActionsPerIntegration}`);
    console.log(`   Features Enabled: ${Object.keys(defaultUIConfig.features).filter(k => defaultUIConfig.features[k]).length}`);
    console.log(`   Failure Email Reports: ${defaultUIConfig.notifications.failureEmailReports.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`   Version: ${defaultUIConfig.version}`);

    console.log('\n✅ UI configuration populated successfully!');

  } catch (error) {
    console.error('❌ Failed to populate UI configuration:', error);
    process.exit(1);
  } finally {
    // MongoDB client doesn't expose disconnect in this module
    // Connection will close when process exits
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  populateUIConfig();
}

module.exports = { populateUIConfig, defaultUIConfig };
