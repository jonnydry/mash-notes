
import { insertNote, updateNote, deleteActiveNote } from './db';
import { initSearchIndex, getSearchIndexSize, searchNotes } from './search';

async function runTests() {
    console.log('--- Starting MASH Sync Engine Integration Tests ---');

    // 1. Setup: Initialize the search index
    await initSearchIndex();
    console.log(`Initial Index Size: ${getSearchIndexSize()}`); // Should be 0

    const testTitle = 'Test Note Title';
    const testBody = 'This is a test note body to verify sync.';
    const testFolder = 'Work/Projects';
    const testTags = ['test', 'integration'];

    // 2. Test: Creation Lifecycle
    console.log('\n[TEST]: Create Note...');
    try {
        const newNote = await insertNote({
            title: testTitle,
            body: testBody,
            folder: testFolder,
            tags: testTags,
            pinned: 0
        });
        console.log(`Success: Created note with ID: ${newNote.id}`);

        const sizeAfterCreate = getSearchIndexSize();
        console.log(`Expected Size: 1 | Actual Size: ${sizeAfterCreate}`);
        if (sizeAfterCreate !== 1) throw new Error('Failed: Index size did not increment after creation.');

        // Verify specific content in search
        const results = searchNotes(testTitle);
        if (results.length === 0 || results[0].id !== newNote.id) {
            throw new Error(`Failed: Note title "${testTitle}" not found in search index.`);
        }
        console.log('Success: Searchable by content.');
    } catch (e) {
        console.error(`FAIL: Creation Test - ${e.message}`);
        process.exit(1);
    }

    // 3. Test: Update Lifecycle
    console.log('\n[TEST]: Update Note Content...');
    try {
        const newBody = 'Updated test note body content.';
        const updatedNote = await updateNote(newNote.id, { body: newBody });
        console.log(`Success: Updated note with ID: ${updatedNote.id}`);

        // Verify immediate search reflect (should not be stale)
        const resultsAfterUpdate = searchNotes('Updated'); // Search for a keyword in the new body
        if (resultsAfterUpdate.length === 0 || resultsAfterUpdate[0].body !== newBody) {
            throw new Error(`Failed: Note content did not update in search index immediately.`);
        }
        console.log('Success: Search reflects updates immediately.');
    } catch (e) {
        console.error(`FAIL: Update Test - ${e.message}`);
        process.exit(1);
    }

    // 4. Test: Deletion Lifecycle
    console.log('\n[TEST]: Delete Note...');
    try {
        const success = await deleteActiveNote(newNote.id);
        if (!success) throw new Error('Failed: deleteActiveNote returned false.');
        console.log('Success: Deleted note from DB.');

        const finalSize = getSearchIndexSize();
        console.log(`Expected Size: 0 | Actual Size: ${finalSize}`);
        if (finalSize !== 0) throw new Error('Failed: Index size did not decrement after deletion.');

        const resultsAfterDelete = searchNotes(testTitle);
        if (resultsAfterDelete.length !== 0) {
            throw new Error(`Failed: Note "${testTitle}" still persists in search index.`);
        }
        console.log('Success: Purged from search correctly.');
    } catch (e) {
        console.error(`FAIL: Deletion Test - ${e.message}`);
        process.exit(1);
    }

    console.log('\n--- ALL INTEGRATION TESTS PASSED ---');
    process.exit(0);
}

runTests().catch(err => {
    console.error('Unexpected error during test suite:', err);
    process.exit(1);
});
