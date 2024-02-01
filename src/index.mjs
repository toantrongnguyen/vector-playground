import weaviate, { ApiKey } from 'weaviate-ts-client';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { Configuration, OpenAIApi } from "openai";

dotenv.config();

const client = weaviate.client({
  scheme: 'https',
  host: process.env.WEAVIATE_URL,
  apiKey: new ApiKey(process.env.WEAVIATE_API_KEY),
  headers: { 'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY },
});

const classObj = {
  'class': 'Question',
  'vectorizer': 'text2vec-openai',  // If set to "none" you must always provide vectors yourself. Could be any other "text2vec-*" also.
  'moduleConfig': {
    'text2vec-openai': {},
    'generative-openai': {}  // Ensure the `generative-openai` module is used for generative queries
  },
};

async function addSchema() {
  const res = await client.schema.classCreator().withClass(classObj).do();
  console.log(res);
}



async function getJsonData() {
  const file = await fetch('https://raw.githubusercontent.com/weaviate-tutorials/quickstart/main/data/jeopardy_tiny.json');
  return file.json();
}

async function importQuestions() {
  // Get the questions directly from the URL
  const data = await import('./question.json');

  // Prepare a batcher
  let batcher = client.batch.objectsBatcher();
  let counter = 0;
  const batchSize = 100;

  for (const question of data) {
    // Construct an object with a class and properties 'answer' and 'question'
    const obj = {
      class: 'Question',
      properties: {
        answer: question.Answer,
        question: question.Question,
        category: question.Category,
      },
    };

    // add the object to the batch queue
    batcher = batcher.withObject(obj);

    // When the batch counter reaches batchSize, push the objects to Weaviate
    if (counter++ == batchSize) {
      // flush the batch queue
      const res = await batcher.do();
      console.log(res);

      // restart the batch queue
      counter = 0;
      batcher = client.batch.objectsBatcher();
    }
  }

  // Flush the remaining objects
  const res = await batcher.do();
  console.log(res);
}

async function setup() {
  // await addSchema();
  await importQuestions();
}



async function nearTextWhereQuery() {
  const res = await client.graphql
    .get()
    .withClassName('Question')
    .withFields('question answer category')
    .withNearText({ concepts: ['cute'] })
    .withWhere({
      'path': ['category'],
      'operator': 'Equal',
      'valueText': 'ANIMALS',
    })
    .withLimit(2)
    .do();

  console.log(JSON.stringify(res, null, 2));
  return res;

}

async function generativeSearchQuery(concepts) {
  const res = await client.graphql
    .get()
    .withClassName('Question')
    .withFields('question answer category')
    .withNearText({ concepts })
    // .withGenerate({ singlePrompt: 'Explain {answer} as you might to a five-year-old.' })
    // .withLimit(2)
    .do();

  console.log(JSON.stringify(res, null, 2));
  return res.data.Get.Question;
}


const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

async function getChatCompletion({ prompt, context }) {
  const chatCompletion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: context,
      },
      { role: "user", content: prompt },
    ],
  });

  const result = chatCompletion.data.choices[0].message;
  console.log(result);
}

async function run() {
  const questionContext = await generativeSearchQuery(['2 legs']);
  // await nearTextWhereQuery();
  const context = questionContext
    .map((context, index) => {
      const { question, answer, category } = context;
      return `
      Document ${index + 1}
      Title: ${question}
      ${answer}
`;
    })
    .join("\n\n");
  await getChatCompletion({ prompt: 'list all animals', context })
}

// setup()
run();
