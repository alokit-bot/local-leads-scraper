#!/usr/bin/env python3
"""
Upload a file to the Alokit Google Drive.

Usage:
  python3 drive_upload.py <local_file> <folder_key>

folder_key options: root, leads, leads_bengaluru, projects, exports,
                    exports_spreadsheets, shared

Requires:
  - drive_oauth.json  (OAuth credentials + refresh token)
  - drive_folders.json (folder ID map)
  Both files should be in the same directory as this script or
  at paths set via DRIVE_OAUTH and DRIVE_FOLDERS env vars.
"""

import sys, os, json
from pathlib import Path

def get_drive_service():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    creds_path = os.environ.get('DRIVE_OAUTH',
        str(Path(__file__).parent.parent / 'drive_oauth.json'))
    with open(creds_path) as f:
        c = json.load(f)

    creds = Credentials(
        token=None, refresh_token=c['refresh_token'],
        client_id=c['client_id'], client_secret=c['client_secret'],
        token_uri=c['token_uri'],
        scopes=['https://www.googleapis.com/auth/drive']
    )
    creds.refresh(Request())
    return build('drive', 'v3', credentials=creds)

def get_folder_id(key='root'):
    folders_path = os.environ.get('DRIVE_FOLDERS',
        str(Path(__file__).parent.parent / 'drive_folders.json'))
    with open(folders_path) as f:
        folders = json.load(f)
    return folders.get(key) or folders['root']

def upload(local_path, folder_key='root', filename=None):
    from googleapiclient.http import MediaFileUpload
    import mimetypes

    drive = get_drive_service()
    folder_id = get_folder_id(folder_key)
    fname = filename or Path(local_path).name
    mime = mimetypes.guess_type(local_path)[0] or 'application/octet-stream'

    media = MediaFileUpload(local_path, mimetype=mime, resumable=False)
    result = drive.files().create(
        body={'name': fname, 'parents': [folder_id]},
        media_body=media,
        fields='id,name,webViewLink'
    ).execute()

    print(f"✅ Uploaded: {result['name']}")
    print(f"🔗 {result['webViewLink']}")
    return result

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    local_file  = sys.argv[1]
    folder_key  = sys.argv[2] if len(sys.argv) > 2 else 'root'
    upload(local_file, folder_key)
