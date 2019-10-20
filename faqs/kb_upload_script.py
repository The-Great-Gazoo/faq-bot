import requests
import json

# this script parses and transforms data for batch uploads to Genesys server
# to be used to train models

# edit variables here:
file_name = "faqs.txt"
external_url = "https://www.mycertifiedservice.ca/auto-maintenance-faqs.html"
access_token = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJvcmdJZCI6IjUwN2M2Yjk0LWQzNWEtNDhjZS05OTM3LWMyZTRhYTY5YzI3OSIsImV4cCI6MTU3MTU1ODQ4MiwiaWF0IjoxNTcxNTU0ODgyfQ.GHTUV-t59dMGY-AsHKmGWMMwX-2w744_7rSIbY_2aBY"
kb_id = "04e80662-d179-4da4-a24b-f5e055dbd71e"

json_array = []

with open(file_name) as lines:
    content = lines.read().splitlines()

def build_doc(question, answer):
    doc = {
        "type": "faq",
        "faq": {
            "question": question,
            "answer": answer
        },
        "externalUrl": external_url
    }

    json_array.append(doc)

line_num = 0
question = ""
answer = ""
for line in content:
    # empty line indicates the start of a new question/answer pair (doc)
    if line == "":
        build_doc(question, answer)
        question = ""
        answer = ""
        line_num = 0
    elif line_num == 0:
        question += line
        line_num += 1
    else:
        if line_num > 1:
            answer += " "
        answer += line
        line_num += 1

# uncomment for debugging, should check this before uploading to server
# print(json_array)

def upload_to_genesys():
    global json_array

    payload = json.dumps(json_array)

    url = f"https://api.genesysappliedresearch.com/v2/knowledge/knowledgebases/{kb_id}/languages/en-US/documents"    
    
    headers = {
        'Content-Type': "application/json",
        'organizationid': "507c6b94-d35a-48ce-9937-c2e4aa69c279",
        'token': access_token,
        'cache-control': "no-cache"
    }

    response = requests.request("PATCH", url, data=payload, headers=headers)

    print(response.status_code)

upload_to_genesys()
