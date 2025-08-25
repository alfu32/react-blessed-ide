#!/usr/bin/env bash

git pull origin work
git push origin work --tags
git checkout staging
git pull origin staging
git merge --ff-only work
git push origin staging --tags
git checkout pub
git pull origin pub
git merge --ff-only work
git push origin pub --tags
git checkout work