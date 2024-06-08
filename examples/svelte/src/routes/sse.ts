import {River} from 'river.ts'
import * as river from 'river.ts'

const events = new River().map_event("test", {
    data: {
        message: "This is a test SSE message."
    }
})