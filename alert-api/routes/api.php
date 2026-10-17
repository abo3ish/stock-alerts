<?php

use App\Http\Controllers\AlertController;
use Illuminate\Support\Facades\Route;

Route::apiResource('alerts', AlertController::class)->except('show');
