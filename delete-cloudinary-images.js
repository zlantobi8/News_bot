// delete-cloudinary-images.js
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

// ------------------------
// CLOUDINARY CONFIG
// ------------------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ------------------------
// HELPERS
// ------------------------
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

// ------------------------
// GET ALL RESOURCES
// ------------------------
async function getAllResources(resourceType = 'image') {
  try {
    console.log(`\n📦 Fetching all ${resourceType}s from Cloudinary...`);
    
    let allResources = [];
    let nextCursor = null;
    
    do {
      const result = await cloudinary.api.resources({
        type: 'upload',
        resource_type: resourceType,
        max_results: 500,
        next_cursor: nextCursor
      });
      
      allResources = allResources.concat(result.resources);
      nextCursor = result.next_cursor;
      
      console.log(`   Retrieved ${allResources.length} ${resourceType}s so far...`);
      
      if (nextCursor) {
        await delay(1000); // Rate limiting
      }
    } while (nextCursor);
    
    console.log(`\n✅ Total ${resourceType}s found: ${allResources.length}`);
    return allResources;
    
  } catch (error) {
    console.error(`❌ Error fetching resources:`, error.message);
    throw error;
  }
}

// ------------------------
// DELETE RESOURCES IN BATCHES
// ------------------------
async function deleteResourcesInBatches(resources, batchSize = 100) {
  try {
    const totalResources = resources.length;
    console.log(`\n🗑️  Starting deletion of ${totalResources} resources...`);
    console.log(`   Using batch size: ${batchSize}`);
    
    let deletedCount = 0;
    let failedCount = 0;
    
    // Process in batches
    for (let i = 0; i < resources.length; i += batchSize) {
      const batch = resources.slice(i, i + batchSize);
      const publicIds = batch.map(r => r.public_id);
      
      console.log(`\n📤 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(totalResources / batchSize)}`);
      console.log(`   Deleting ${publicIds.length} resources...`);
      
      try {
        const result = await cloudinary.api.delete_resources(publicIds, {
          resource_type: 'image'
        });
        
        // Count successful deletions
        const deleted = Object.values(result.deleted).filter(status => status === 'deleted').length;
        const notFound = Object.values(result.deleted).filter(status => status === 'not_found').length;
        
        deletedCount += deleted;
        failedCount += (publicIds.length - deleted - notFound);
        
        console.log(`   ✅ Deleted: ${deleted}`);
        if (notFound > 0) console.log(`   ⚠️  Not found: ${notFound}`);
        if (failedCount > 0) console.log(`   ❌ Failed: ${failedCount}`);
        
      } catch (batchError) {
        console.error(`   ❌ Batch deletion failed:`, batchError.message);
        failedCount += publicIds.length;
      }
      
      // Rate limiting between batches
      if (i + batchSize < resources.length) {
        console.log(`   ⏳ Waiting 2 seconds before next batch...`);
        await delay(2000);
      }
    }
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   DELETION SUMMARY`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   ✅ Successfully deleted: ${deletedCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   📊 Total processed: ${totalResources}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    return { deletedCount, failedCount, totalResources };
    
  } catch (error) {
    console.error(`❌ Error during batch deletion:`, error.message);
    throw error;
  }
}

// ------------------------
// DELETE ALL RESOURCES (with confirmation)
// ------------------------
async function deleteAllResources(resourceType = 'image', skipConfirmation = false) {
  try {
    console.log(`\n🚀 CLOUDINARY BULK DELETE TOOL`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    // Fetch all resources
    const resources = await getAllResources(resourceType);
    
    if (resources.length === 0) {
      console.log(`\n✅ No ${resourceType}s found. Cloudinary is already clean!`);
      return { deletedCount: 0, failedCount: 0, totalResources: 0 };
    }
    
    // Show sample of what will be deleted
    console.log(`\n📋 Sample of ${resourceType}s to be deleted:`);
    resources.slice(0, 5).forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.public_id} (${(r.bytes / 1024).toFixed(2)} KB)`);
    });
    if (resources.length > 5) {
      console.log(`   ... and ${resources.length - 5} more`);
    }
    
    // Confirmation
    if (!skipConfirmation) {
      console.log(`\n⚠️  WARNING: This will DELETE ALL ${resources.length} ${resourceType}s!`);
      console.log(`   This action CANNOT be undone!\n`);
      
      const confirmed = await askConfirmation(`   Type 'yes' or 'y' to confirm deletion: `);
      
      if (!confirmed) {
        console.log(`\n❌ Deletion cancelled by user.`);
        return { deletedCount: 0, failedCount: 0, totalResources: resources.length, cancelled: true };
      }
    }
    
    console.log(`\n✅ Confirmation received. Starting deletion...`);
    
    // Delete in batches
    const result = await deleteResourcesInBatches(resources);
    
    return result;
    
  } catch (error) {
    console.error(`\n❌ Fatal error:`, error.message);
    throw error;
  }
}

// ------------------------
// DELETE BY FOLDER (Optional)
// ------------------------
async function deleteByFolder(folderPath) {
  try {
    console.log(`\n🗂️  Fetching resources from folder: ${folderPath}`);
    
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: folderPath,
      max_results: 500
    });
    
    const resources = result.resources;
    console.log(`   Found ${resources.length} resources in folder`);
    
    if (resources.length === 0) {
      console.log(`\n✅ Folder is empty or doesn't exist`);
      return;
    }
    
    const confirmed = await askConfirmation(`\n⚠️  Delete all ${resources.length} resources in '${folderPath}'? (yes/no): `);
    
    if (!confirmed) {
      console.log(`\n❌ Deletion cancelled`);
      return;
    }
    
    return await deleteResourcesInBatches(resources);
    
  } catch (error) {
    console.error(`❌ Error deleting folder:`, error.message);
    throw error;
  }
}

// ------------------------
// MAIN EXECUTION
// ------------------------
async function main() {
  try {
    // Validate environment variables
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      throw new Error('Missing Cloudinary credentials in .env file');
    }
    
    console.log(`\n🔐 Connected to Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME}`);
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const mode = args[0] || 'all';
    
    switch (mode) {
      case 'all':
        await deleteAllResources('image');
        break;
        
      case 'folder':
        const folderPath = args[1];
        if (!folderPath) {
          console.error('❌ Please specify a folder path: node delete-cloudinary-images.js folder <folder-path>');
          process.exit(1);
        }
        await deleteByFolder(folderPath);
        break;
        
      case 'video':
        await deleteAllResources('video');
        break;
        
      case 'raw':
        await deleteAllResources('raw');
        break;
        
      case '--force':
        console.log('⚡ FORCE MODE: Skipping confirmation');
        await deleteAllResources('image', true);
        break;
        
      default:
        console.log(`\n📖 USAGE:`);
        console.log(`   node delete-cloudinary-images.js [mode] [options]\n`);
        console.log(`   Modes:`);
        console.log(`   • all              - Delete all images (default)`);
        console.log(`   • video            - Delete all videos`);
        console.log(`   • raw              - Delete all raw files`);
        console.log(`   • folder <path>    - Delete resources in specific folder`);
        console.log(`   • --force          - Skip confirmation (dangerous!)\n`);
        console.log(`   Examples:`);
        console.log(`   node delete-cloudinary-images.js all`);
        console.log(`   node delete-cloudinary-images.js folder news/sports`);
        console.log(`   node delete-cloudinary-images.js --force\n`);
        break;
    }
    
    console.log(`\n✅ Script completed successfully!`);
    process.exit(0);
    
  } catch (error) {
    console.error(`\n❌ Script failed:`, error.message);
    process.exit(1);
  }
}

// Run main function
main();

export { deleteAllResources, deleteByFolder, getAllResources };