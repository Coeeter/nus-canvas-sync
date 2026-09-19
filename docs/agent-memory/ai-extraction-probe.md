# Read-only Codex extraction probe

Run from `/Users/nas/.codex/worktrees/6338/nus-canvas-sync`:

```sh
bun -e 'import {Effect} from "effect"; import {BunServices} from "@effect/platform-bun"; import {CodexCliExecutor,interpretCourse} from "./src/ai/interpret.ts"; const record={id:"course:97325:announcement:493987",courseCode:"IS1128",kind:"announcement",sourceUrl:null,contentHash:"probe",fields:{title:"Project proposal",message:"Submit the proposal by September 30."}}; const result=await Effect.runPromise(interpretCourse({courseCode:"IS1128",courseContext:"Extract one concrete required task only.",changedRecords:[record],referencedDocuments:[]},await Bun.file("prompts/extract-course.md").text(),await Bun.file("schemas/course-candidates.schema.json").text(),new CodexCliExecutor()).pipe(Effect.provide(BunServices.layer))); console.log(JSON.stringify({candidateCount:result.candidates.length,candidate:result.candidates[0]??null},null,2));'
```

This used the configured Terra Medium executor and only read local prompt/schema
files plus the supplied synthetic source record. The sanitized full candidate
is at `/tmp/nus-sync-codex-extraction-final.json`:

```json
{
  "candidateCount": 1,
  "candidate": {
    "courseCode": "IS1128",
    "sourceIds": ["course:97325:announcement:493987"],
    "evidence": "“Submit the proposal by September 30.”",
    "kind": "assessment",
    "title": "Project proposal",
    "requiredAction": "Submit the project proposal.",
    "availableFrom": null,
    "dueAt": null,
    "eventEndsAt": null,
    "dateEvidence": {
      "availableFrom": {
        "state": "unknown",
        "value": null,
        "sourceIds": ["course:97325:announcement:493987"]
      },
      "dueAt": {
        "state": "unknown",
        "value": null,
        "sourceIds": ["course:97325:announcement:493987"]
      },
      "eventEndsAt": {
        "state": "unknown",
        "value": null,
        "sourceIds": ["course:97325:announcement:493987"]
      }
    },
    "confidence": 0.93,
    "ambiguity": "The stated deadline lacks a year and timezone.",
    "reviewIssue": {
      "kind": "ambiguous-evidence",
      "fields": ["dueAt"],
      "values": [
        {
          "field": "dueAt",
          "sourceId": "course:97325:announcement:493987",
          "state": "value",
          "value": "September 30"
        }
      ]
    },
    "matchTaskId": null,
    "logicalKey": "source:course:97325:announcement:493987#proposal"
  }
}
```
