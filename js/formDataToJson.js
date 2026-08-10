// Retrieves file and returns as json object
async function retrieveFile(filePath) {
	try {
		const response = await fetch(filePath);

		if (!response.ok) {
			throw new Error("Network response was not ok");
		}
		// Returns file contents in a json format
		return await response.json();
	} catch (error) {
		console.error("There was a problem with the fetch operation:", error);
		return null;
	}
}

function isMultiSelect(obj) {
	if (obj && obj.Suggestions !== undefined) {
		return false;
	}

	for (const key in obj) {
		if (typeof obj[key] !== 'boolean') {
			return false;
		}
	}
	return true; // Returns true if all values are booleans
}

// Convert from dictionary to array
function getSelectedOptions(options) {
	let selectedOptions = [];

	for (let key in options) {
		if (options[key]) {
			selectedOptions.push(key);
		}
	}
	return selectedOptions;
}

// Populates fields with form data
function populateObject(data, schema) {
	let reorderedObject = {}

	// Array of fields following proper order of fields in schema
	const schemaFields = schema?.properties?.items ? Object.keys(schema.properties.items) : [];
	const dataFields = Object.keys(data);

	const allFields = [...schemaFields];
	dataFields.forEach(field => {
		if (!allFields.includes(field)) {
			allFields.push(field);
		}
	});

	for (const key of allFields) {
		let value = data[key];

		if (value === undefined || value === null) {
			continue;
		}

		if (schema.properties.items[key]?.type === "object" &&
			schema.properties.items[key]?.properties?.Suggestions) {
				if (typeof value === "object" && !Array.isArray(value)) {
					reorderedObject[key] = value;
				} else {
					reorderedObject[key] = {
						Suggestions: Array.isArray(value) ? value : []
					};
				}
				continue;
			}

		// Adjusts value accordingly if multi-select field
		if ((typeof value === "object" && isMultiSelect(value))) {
			value = getSelectedOptions(value);
		}

		reorderedObject[key] = value;
	}
	return reorderedObject;
}

async function populateCodeJson(data) {
	const filePath = "schemas/schema.json";

	// Retrieves schema with fields in correct order
	const schema = await retrieveFile(filePath);
	let codeJson = {};

	// Populates fields with form data
	if (schema) {
		codeJson = populateObject(data, schema);
	} else {
		console.error("Failed to retrieve JSON data.");
	}

	return codeJson;
}

// Creates json object
async function createCodeJson(data) {
	delete data.submit;
	const codeJson = await populateCodeJson(data);

	window.gh_api_key = data['gh_api_key']
	console.log(window.gh_api_key)

	const jsonString = JSON.stringify(codeJson, null, 2);
	document.getElementById("json-result").value = jsonString;
}

function checkIfResponseGenerated() {
	const textArea = document.getElementById("json-result");
	if(!textArea.value || textArea.value.trim() === '') {
		alert("Please generate your response first by clicking 'Generate your response!' button.");
		return false;
	}
	return true;
}

// Copies json to clipboard
async function copyToClipboard(event) {
	event.preventDefault();

	if (!checkIfResponseGenerated()) {
		return;
	}

	var textArea = document.getElementById("json-result");
	textArea.select();
	document.execCommand("copy")
}

const NEW_BRANCH = 'code-json-branch' + Math.random().toString(36).substring(2, 10);

function getOrgAndRepoArgsGitHub(url) {
	const pattern = /https:\/\/github\.com\/([^\/]+)\/([^\/]+)/;
	const match = url.match(pattern);

	if (match) {
		const owner = match[1];
		const repo = match[2];
		return { owner, repo };
	}
	else {
		throw new Error('Invalid URL!');
	}
}


async function createBranchOnProject(projectURL, token) {
	const { owner, repo } = getOrgAndRepoArgsGitHub(projectURL);

	const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/main`,
		{
			method: 'GET',
			headers: {
				'Authorization': 'token '.concat(token),
			},
		}
	);

	const data = await response.json();

	if (response.ok) {
		const sha = data.object.sha;

		const createBranchApiUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs`;

		// Create the new branch from the base branch
		const newBranchResponse = await fetch(createBranchApiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `token ${token}`,
			},
			body: JSON.stringify({
				ref: `refs/heads/${NEW_BRANCH}`, // Name of the new branch
				sha: sha, // SHA of the base branch (main)
			}),
		});

		const newBranchData = await newBranchResponse.json();

		if (newBranchResponse.ok) {
			console.log('New branch created successfully: ', newBranchData);
			return true;
		}
		else {
			console.error('Error creating new branch: ', newBranchData);
			alert("Failed to create branch on project! Error code: " + newBranchResponse.status + ". Please check API Key permissions and try again.")
			return false;
		}
	}
	else {
		console.error('Error fetching base branch info:', data);
		alert('Error fetching base branch info:', data);
		return false;
	}
}


async function addFileToBranch(projectURL, token, JSONObj) {
	const { owner, repo } = getOrgAndRepoArgsGitHub(projectURL);
	const FILE_PATH = 'lodp-form.json'
	const createFileApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${FILE_PATH}`;
	const encodedContent = btoa(JSONObj);
	console.log("Content: ", encodedContent);
	console.log("Branch: ", NEW_BRANCH);

	const response = await fetch(createFileApiUrl,
		{
			method: 'PUT',
			headers: {
				'Accept': 'application/vnd.github+json',
				'Authorization': 'Bearer '.concat(token),
				'X-GitHub-Api-Version': "2022-11-28"
			},
			body: JSON.stringify({
				message: "Add codejson to project",
				committer: {
					name: "codejson-generator form site",
					email: "opensource@cms.hhs.gov"
				},
				content: encodedContent,
				branch: NEW_BRANCH,
			}),
		}
	);

	const data = await response.json()

	if (response.ok) {
		console.log('File added successfully: ', data);
		return true;
	}
	else {
		console.error('Error adding file: ', data);
		alert("Failed to add file on project! Error code: " + response.status + ". Please check API Key permissions and try again.")
		return false;
	}
}

async function createPR(projectURL, token) {
	const { owner, repo } = getOrgAndRepoArgsGitHub(projectURL);
	const createPrApiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls`;
	const response = await fetch(createPrApiUrl,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': 'token '.concat(token),
				'X-GitHub-Api-Version': "2022-11-28"
			},
			body: JSON.stringify({
				title: "Add code-anti-data-call.json to Project",
				body: "Add generated code-anti-data-call.json file to project. code-anti-data-call.json was generated via codejson-generator form site.",
				head: NEW_BRANCH,
				base: 'main',

			}),
		}
	);

	const data = await response.json();

	if (response.ok) {
		console.log('Pull request created successfully: ', data);
		return true;
	}
	else {
		console.error("Error creating PR!: ", data);
		alert("Failed to create PR on project! Error code: " + response.status + ". Please check API Key permissions and try again.")
		return false;
	}
}

// Creates PR on requested project
async function createProjectPR(event) {
	event.preventDefault();

	if (!checkIfResponseGenerated()) {
		return;
	}

	const textArea = document.getElementById("json-result");
	const JSONObj = JSON.parse(textArea.value)

	if ('gh_api_key' in window) {
		var apiKey = window.gh_api_key;

		if ('repositoryURL' in JSONObj) {
			var prCreated = false;
			//Step 1
			const branchCreated = await createBranchOnProject(JSONObj.repositoryURL, apiKey);
			if (branchCreated) {
				const fileAdded = await addFileToBranch(JSONObj.repositoryURL, apiKey, textArea.value);

				if (fileAdded) {
					prCreated = await createPR(JSONObj.repositoryURL, apiKey);
					if (prCreated) {
						console.log("PR successfully created!");
						alert("PR has been created!");
					}
				}
			}
			else {
				console.error("Could not create branch on requested repository with the requested API key!");
				alert("Could not create branch on requested repository with the requested API key!");
			}
		}
		else {
			console.error("No URL found!");
			alert("No URL given for project! Please provide project URL in repositoryURL text box");
		}

	}
	else {
		console.error("No API key found!");
		alert("No API Key in submitted data! Please provide an API key");
	}
}

// Triggers local file download
async function downloadFile(event) {
	event.preventDefault();

	if (!checkIfResponseGenerated()) {
		return;
	}

	const codeJson = document.getElementById("json-result").value
	const jsonObject = JSON.parse(codeJson);
	const jsonString = JSON.stringify(jsonObject, null, 2);
	const blob = new Blob([jsonString], { type: "application/json" });

	// Create anchor element and create download link
	const link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = "lodp-form.json";

	// Trigger the download
	link.click();
}

// Creates Issue Title
function generateIssueTitle(JSONObj) {
	let now = new Date();
	let localeString = now.toLocaleString();

	// const submitterName = JSONObj["Name"] || "Anonymous";
	return `Living HHS Open Data Plan Suggestions: ${localeString}`;
}

// Creates Issue Body
function generateIssueBody(JSONObj) {
	let body = "## Living HHS Open Data Plan — Feedback to HHS\n\n";

	// body += `**Submitted by:** ${JSONObj["Name"] || "Anonymous"}\n`;
	// body += `**Email:** ${JSONObj["Email"] || "Not provided"}\n\n`;

	body += "Summary of Suggestions:\n\n";

	const categories = [
		"HHS Objectives, Values, and Return on Investment (ROI) with Data",
		"Unified HHS for Data Sharing",
		"Data Collection Processes for Open Formats",
		"Data Usage Information",
		"Prioritizing Public Data Asset Review",
		"Improving Processes for Meeting Open Data Goals",
		"Intra-HHS Data Sharing — Be the Change",
		"Real-World Data for Impact",
		"Public-Private Partnerships with Transparency to Accelerate Impact",
		"Public Engagement with, by, and for We the People",
		"Appendix A - Acronyms, Definitions, Keywords, and Concepts",
        "Appendix B - Open Science Disclosure Risk Management (2019 NSTC SOS)",
        "Appendix C - HHS Open Data Action Items with Timeline",
        "Appendix D - HHS Partnerships with Transparency",
        "Other"
	];

	categories.forEach(category => {
		if (JSONObj[category] && JSONObj[category].Suggestions && JSONObj[category].Suggestions.length > 0) {
			body += `- **${category}:** ${JSONObj[category].Suggestions.length} suggestions(s)\n`;
		}
	});

	body += "\n### Full Submission Details:\n\n";
	body += "```json\n";
	body += JSON.stringify(JSONObj, null, 2);
	body += "\n```\n";

	return body;
}

// Triggers new issue in GitHub
async function createGitHubIssueForm(event) {
	event.preventDefault();

	if (!checkIfResponseGenerated()) {
		return;
	}

	const textArea = document.getElementById("json-result");
	const JSONObj = JSON.parse(textArea.value);

	if (!textArea.value) {
		alert("No data found! Please submit data first.");
		return;
	}

	try {
		JSONObj;
	} catch (error) {
		alert("Invalid JSON data. Please check form submission");
	}

	try {
		const issueTitle = generateIssueTitle(JSONObj);
		const issueBody = generateIssueBody(JSONObj);

		const githubIssueURL = createGitHubNewIssueURL(issueTitle, issueBody);

		window.open(githubIssueURL, '_blank');

		alert("GitHub issue form opened in new tab. Please review and click 'Submit new issue' to create it.");

	} catch (error) {
		console.error("Error opening GitHub issue form:", error);
		alert("Error opening GitHub issue form:" + error.message)
	}
}

// Create GitHub URL
function createGitHubNewIssueURL(title, body) {
	// const textArea = document.getElementById("json-result");
	// const JSONObj = JSON.parse(textArea.value);
	// const agency = JSONObj["HHS Division"];
	// const match = agency.match(/\(([^)]+)\)/);

	const baseURL = "https://github.com/HHS//living-hhs-open-data-plan/issues/new";
	const params = new URLSearchParams({
		title: title,
		body: body,
		labels: ['suggestions', 'data-management']
	});

	return `${baseURL}?${params.toString()}`;
}

// Creates Auto Issue
async function createAutoGitHubIssue(event) {
	event.preventDefault();

	if (!checkIfResponseGenerated()) {
		return;
	}

	const textArea = document.getElementById("json-result");
	const JSONObj = JSON.parse(textArea.value);

	if (!('gh_api_key' in window)) {
		console.error("No API key!");
		alert("No API key submitted! Please provide an API key.");
		return;
	}

	const apiKey = window.gh_api_key;

	try {
		const issueTitle = generateIssueTitle(JSONObj);
		const issueBody = generateIssueBody(JSONObj);

		const success = await createIssueOnGitHub(apiKey, issueTitle, issueBody);

		if (success) {
			console.log("GitHub issue created!");
			alert("GitHub issue has been created!");
		}
	} catch (error) {
		console.error("Error creating issue:", error);
		alert("Error creating issue:" + error.message);
	}
}

async function createIssueOnGitHub(token, title, body) {
	const textArea = document.getElementById("json-result");
	const JSONObj = JSON.parse(textArea.value);
	const agency = JSONObj["HHS Division"];
	const match = agency.match(/\(([^)]+)\)/);

	const createIssueAPIURL = "https://api.github.com/repos/HHS/living-hhs-open-data-plan/issues";

	const response = await fetch(createIssueAPIURL,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `token ${token}`,
				'X-GitHub-Api-Version': "2022-11-28"
			},
			body: JSON.stringify({
				title: title,
				body: body,
				labels: ['suggestions', 'data-management']
			})
		});

	const data = await response.json();

	if (response.ok) {
		console.log('Issue created successfully:', data);
		console.log('Issue URL:', data.html_url);
		alert('Issue created!', data.html_url);
		return;
	} else {
		console.error('Error creating issue:', data);
		alert('Failed to create issue');
		return false;
	}

}

// Triggers email(mailtolink)
async function emailFile(event) {
	event.preventDefault();

	if (!checkIfResponseGenerated()) {
		return;
	}

	const codeJson = document.getElementById("json-result").value
	const jsonObject = JSON.parse(codeJson);

	try {
		const cleanData = { ...jsonObject };
		delete cleanData.submit;

		const jsonString = JSON.stringify(cleanData, null, 2);

		const subject = "Living HHS Open Data Plan — Feedback to HHS";
		const body = `Hello,\n\nI have submitted suggestions for Living HHS Open Data Plan:\n\n${jsonString}\n\nThank you!`;

		// const recipients = ["opensource@cms.hhs.gov", "cdo@hhs.gov"];
		const recipients = ["opensource@cms.hhs.gov", "cdo@hhs.gov"];

		const mailtoLink = `mailto:${recipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

		window.location.href = mailtoLink;

		console.log("Email client opened");
	} catch {
		console.error("Error preparing email:", error);
		showNotificationModal("Error preparing email. Please try again or copy the data manually.", 'error');
	}
}

window.createCodeJson = createCodeJson;
window.copyToClipboard = copyToClipboard;
window.downloadFile = downloadFile;
window.createProjectPR = createProjectPR;
window.createAutoGitHubIssue = createAutoGitHubIssue;
window.createGitHubIssueForm = createGitHubIssueForm;
window.emailFile = emailFile;
